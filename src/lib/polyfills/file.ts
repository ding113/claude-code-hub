interface NodeFileOptions extends BlobPropertyBag {
  lastModified?: number;
}

// Create a minimal File polyfill for Node.js environments
// This is needed because Zod 4.x checks for File API on initialization
class NodeFile {
  readonly name: string;
  readonly lastModified: number;
  readonly webkitRelativePath: string;
  readonly size: number;
  readonly type: string;

  constructor(_fileBits: BlobPart[], fileName: string, options: NodeFileOptions = {}) {
    this.name = fileName;
    this.webkitRelativePath = "";
    this.lastModified =
      typeof options.lastModified === "number" ? options.lastModified : Date.now();
    this.size = 0;
    this.type = options.type || "";
  }

  // Stub methods to satisfy interface
  arrayBuffer(): Promise<ArrayBuffer> {
    return Promise.resolve(new ArrayBuffer(0));
  }

  bytes(): Promise<Uint8Array> {
    return Promise.resolve(new Uint8Array(0));
  }

  slice(): Blob {
    return new Blob([]);
  }

  stream(): ReadableStream {
    return new ReadableStream();
  }

  text(): Promise<string> {
    return Promise.resolve("");
  }
}

export function ensureFilePolyfill(): void {
  // Apply polyfill if File is not already defined
  if (typeof globalThis !== "undefined" && typeof globalThis.File === "undefined") {
    // Use type assertion to bypass strict type checking
    // This polyfill only needs to satisfy Zod's runtime checks, not full File API
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).File = NodeFile;
  }
}

// Execute immediately to ensure File is available before Zod initialization
ensureFilePolyfill();
