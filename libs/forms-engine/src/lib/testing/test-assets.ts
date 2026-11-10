import { AssetLink, AssetRef, AssetStore, StarterInfo, StarterPicture } from '../fill/contract';
import { mockStarter, mockStarters } from './starter-art';

/** An in-memory picture store for specs: the mock starter pictures, uploads remembered with a fixed size. */
export class TestAssetStore implements AssetStore {
  readonly uploads: { kind: 'photo' | 'template'; type: string }[] = [];
  photosAllowed = true;
  size = { width: 1600, height: 1200 };
  private readonly links = new Map<string, AssetLink>();
  private n = 0;

  constructor(preset: Record<string, { width: number; height: number }> = {}) {
    for (const [id, s] of Object.entries(preset)) this.links.set(id, { assetId: id, ...s, mime: 'image/jpeg', url: `https://files.test/${id}` });
  }

  async starters(): Promise<StarterInfo[]> {
    return mockStarters('https://api.test');
  }
  async starter(id: string): Promise<StarterPicture> {
    const s = mockStarter(id, 'https://api.test');
    if (!s) throw new Error('unknown starter');
    return s;
  }
  async asset(id: string): Promise<AssetLink> {
    const l = this.links.get(id);
    if (!l) throw new Error('unknown asset');
    return l;
  }
  canAddPhotos(): boolean {
    return this.photosAllowed;
  }
  uploadPhoto(file: Blob): Promise<AssetRef> {
    return this.put('photo', file);
  }
  uploadTemplate(file: Blob): Promise<AssetRef> {
    return this.put('template', file);
  }
  private async put(kind: 'photo' | 'template', file: Blob): Promise<AssetRef> {
    this.n += 1;
    this.uploads.push({ kind, type: file.type });
    const id = `00000000-0000-4000-8000-${String(this.n).padStart(12, '0')}`;
    this.links.set(id, { assetId: id, ...this.size, mime: file.type, url: `https://files.test/${id}` });
    return { assetId: id, ...this.size, mime: file.type };
  }
}
