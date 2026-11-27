import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { Request } from 'express';
import multer from 'multer';
import { config } from '../config';
import { HttpException } from '../middleware/error.middleware';

type R2Settings = Pick<
  typeof config,
  'r2EndpointUrl' | 'r2AccessKeyId' | 'r2SecretAccessKey' | 'r2BucketName' | 'r2PublicUrl'
>;

const R2_SETTINGS: [keyof R2Settings, string][] = [
  ['r2EndpointUrl', 'R2_ENDPOINT_URL'],
  ['r2AccessKeyId', 'R2_ACCESS_KEY_ID'],
  ['r2SecretAccessKey', 'R2_SECRET_ACCESS_KEY'],
  ['r2BucketName', 'R2_BUCKET_NAME'],
  ['r2PublicUrl', 'R2_PUBLIC_URL'],
];

/**
 * In production every R2 setting must be present: without them images would
 * silently be stored inside the database and make every product page heavy.
 * Elsewhere (local development, tests) they are optional.
 */
export function assertStorageConfigured(settings: R2Settings, nodeEnv: string | undefined): void {
  const missing = R2_SETTINGS.filter(([key]) => !settings[key]).map(([, name]) => name);
  if (nodeEnv === 'production' && missing.length > 0) {
    throw new Error(`Image storage is not configured. Set ${missing.join(', ')}.`);
  }
}

class R2StorageClient {
  private client: S3Client | null = null;
  private r2Enabled: boolean;
  private bucketName: string | null;
  private publicUrl: string | null;

  constructor() {
    assertStorageConfigured(config, process.env.NODE_ENV);
    this.r2Enabled = this.checkR2Config();
    this.bucketName = config.r2BucketName;
    this.publicUrl = config.r2PublicUrl;

    console.log(
      `R2 Storage Configuration Status: ${
        this.r2Enabled ? 'Enabled' : 'Disabled (development: images are stored in the database)'
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
    return R2_SETTINGS.every(([key]) => Boolean(config[key]));
  }

  async uploadFile(
    buffer: Buffer,
    filename: string,
    contentType: string = 'image/jpeg'
  ): Promise<string> {
    if (!this.r2Enabled) {
      // Development only (production requires R2): keep the image as a data URL.
      const base64Data = buffer.toString('base64');
      return `data:${contentType};base64,${base64Data}`;
    }

    try {
      const ext = filename.split('.').pop() || 'jpg';
      const uniqueFilename = `${randomUUID()}.${ext}`;

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

}

export const r2Client = new R2StorageClient();

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Multer for admin image fields: in memory, at most 5 MB, whether the image
 * comes as a file or as data: text (base64 is 4/3 the size, plus the prefix).
 */
export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, fieldSize: Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 1024 },
});

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
