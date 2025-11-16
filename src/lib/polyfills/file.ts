interface NodeFileOptions extends BlobPropertyBag {
  lastModified?: number;
}

class NodeFile extends Blob {
  readonly name: string;
  readonly lastModified: number;
  readonly webkitRelativePath: string;

  constructor(fileBits: BlobPart[], fileName: string, options: NodeFileOptions = {}) {
    const { lastModified, ...blobOptions } = options;
    super(fileBits, blobOptions);
    this.name = fileName;
    this.webkitRelativePath = "";
    this.lastModified = typeof lastModified === "number" ? lastModified : Date.now();
  }
}

export function ensureFilePolyfill(): void {
  if (typeof globalThis.File === "undefined") {
    (globalThis as typeof globalThis & { File: typeof NodeFile }).File = NodeFile;
  }
}

ensureFilePolyfill();
