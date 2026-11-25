import { describe, expect, it } from 'vitest';
import { assertStorageConfigured } from '../src/services/storage.service';

const complete = {
  r2EndpointUrl: 'https://account.r2.cloudflarestorage.com',
  r2AccessKeyId: 'key',
  r2SecretAccessKey: 'secret',
  r2BucketName: 'bucket',
  r2PublicUrl: 'https://img.example.com',
};

describe('image storage settings', () => {
  it('are required in production', () => {
    expect(() => assertStorageConfigured({ ...complete, r2BucketName: null }, 'production')).toThrow(/R2_BUCKET_NAME/);
  });

  it('are optional elsewhere (images then live in the database)', () => {
    expect(() => assertStorageConfigured({ ...complete, r2BucketName: null }, 'development')).not.toThrow();
    expect(() => assertStorageConfigured(complete, 'production')).not.toThrow();
  });
});
