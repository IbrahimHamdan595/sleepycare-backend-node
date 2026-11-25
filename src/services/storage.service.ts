import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import { Request } from 'express';
import multer from 'multer';
import { config } from '../config';
import { HttpException } from '../middleware/error.middleware';

class R2StorageClient {
  private client: S3Client | null = null;
  private r2Enabled: boolean;
  private bucketName: string | null;
  private publicUrl: string | null;

  constructor() {
    this.r2Enabled = this.checkR2Config();
    this.bucketName = config.r2BucketName;
    this.publicUrl = config.r2PublicUrl;

    console.log(
      `R2 Storage Configuration Status: ${
        this.r2Enabled ? 'Enabled' : 'Disabled (using base64 fallback)'
      }`
    );

    if (this.r2Enabled) {
      try {
        this.client = new S3Client({
          region: 'auto',
          endpoint: config.r2EndpointUrl!,
          credentials: {
            accessKeyId: config.r2AccessKeyId!,
            secretAccessKey: config.r2SecretAccessKey!,
          },
        });
        console.log(
          `R2 Client initialized successfully. Bucket: ${this.bucketName}, Public URL: ${this.publicUrl}`
        );
      } catch (error) {
        console.error('Failed to initialize R2 client:', error);
        this.r2Enabled = false;
      }
    }
  }

  private checkR2Config(): boolean {
    const endpoint = config.r2EndpointUrl;
    const accessKey = config.r2AccessKeyId;
    const secretKey = config.r2SecretAccessKey;
    const bucketName = config.r2BucketName;
    const publicUrl = config.r2PublicUrl;

    if (!endpoint || !accessKey || !secretKey || !bucketName || !publicUrl) {
      console.log(
        `R2 config incomplete - Endpoint: ${!!endpoint}, AccessKey: ${!!accessKey}, SecretKey: ${!!secretKey}, Bucket: ${!!bucketName}, PublicURL: ${!!publicUrl}`
      );
      return false;
    }

    if (accessKey.includes('your_r2_access_key') || secretKey.includes('your_r2_secret')) {
      console.log('R2 config contains placeholder values');
      return false;
    }

    return true;
  }

  async uploadFile(
    buffer: Buffer,
    filename: string,
    contentType: string = 'image/jpeg'
  ): Promise<string> {
    if (!this.r2Enabled) {
      // Fallback: return base64 data URL
      console.log('R2 not enabled, falling back to base64 encoding');
      const base64Data = buffer.toString('base64');
      return `data:${contentType};base64,${base64Data}`;
    }

    try {
      const ext = filename.split('.').pop() || 'jpg';
      const uniqueFilename = `${uuidv4()}.${ext}`;

      await this.client!.send(
        new PutObjectCommand({
          Bucket: this.bucketName!,
          Key: uniqueFilename,
          Body: buffer,
          ContentType: contentType,
        })
      );

      const publicUrl = `${this.publicUrl}/${uniqueFilename}`;
      console.log(`Successfully uploaded to R2: ${publicUrl}`);
      return publicUrl;
    } catch (error) {
      console.error('R2 upload failed:', error);
      throw new Error(`Failed to upload file to R2: ${error}`);
    }
  }

  async deleteFile(url: string): Promise<boolean> {
    if (!this.r2Enabled || !this.client) {
      return false;
    }

    try {
      const filename = url.split('/').pop()!;
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucketName!,
          Key: filename,
        })
      );
      return true;
    } catch (error) {
      console.error('Failed to delete file from R2:', error);
      return false;
    }
  }

  async generatePresignedUrl(
    filename: string,
    contentType: string = 'image/jpeg',
    expiresIn: number = 3600
  ): Promise<{ upload_url: string; file_url: string; key: string }> {
    if (!this.r2Enabled || !this.client) {
      throw new Error('R2 storage is not configured');
    }

    try {
      const ext = filename.split('.').pop() || 'jpg';
      const uniqueFilename = `${uuidv4()}.${ext}`;

      const command = new PutObjectCommand({
        Bucket: this.bucketName!,
        Key: uniqueFilename,
        ContentType: contentType,
      });

      const uploadUrl = await getSignedUrl(this.client, command, { expiresIn });

      return {
        upload_url: uploadUrl,
        file_url: `${this.publicUrl}/${uniqueFilename}`,
        key: uniqueFilename,
      };
    } catch (error) {
      console.error('Failed to generate presigned URL:', error);
      throw new Error(`Failed to generate presigned URL: ${error}`);
    }
  }

  isEnabled(): boolean {
    return this.r2Enabled;
  }
}

export const r2Client = new R2StorageClient();

/** Multer for admin image fields: in memory, at most 5 MB. */
export const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Raster images only: an SVG can carry scripts.
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'];
const DATA_URL = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i;

/**
 * Uploads the image an admin form sent, either as a file in `fields.file` or as
 * a `data:` URL in `fields.base64`, and returns its URL. Returns null when the
 * form carries no new image (an existing image's URL sent back is ignored).
 */
export async function imageFromRequest(
  req: Request,
  fields: { file: string; base64: string; nameHint: string }
): Promise<string | null> {
  if (req.file && req.file.fieldname === fields.file) {
    if (!IMAGE_TYPES.includes(req.file.mimetype)) {
      throw new HttpException(422, 'Only image files can be uploaded');
    }
    return r2Client.uploadFile(req.file.buffer, req.file.originalname, req.file.mimetype);
  }

  const value = req.body?.[fields.base64];
  if (typeof value === 'string' && value.startsWith('data:')) {
    const match = DATA_URL.exec(value);
    if (!match || !IMAGE_TYPES.includes(match[1].toLowerCase())) {
      throw new HttpException(422, 'Only image files can be uploaded');
    }
    const type = match[1].toLowerCase();
    return r2Client.uploadFile(Buffer.from(match[2], 'base64'), `${fields.nameHint}.${type.split('/')[1]}`, type);
  }

  return null;
}
