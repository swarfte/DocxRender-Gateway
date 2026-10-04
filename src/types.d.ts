// Ambient module declarations for the untyped DOCX rendering dependencies.

declare module 'pizzip' {
  export interface PizZipObject {
    asText(): string;
  }
  export default class PizZip {
    constructor(data?: string | ArrayBuffer | Uint8Array);
    file(name: string): PizZipObject | null;
    file(name: string, data: string | ArrayBuffer | Uint8Array, options?: { binary?: boolean }): PizZip;
    generate(options: { type: 'uint8array'; compression?: 'DEFLATE' | 'STORE' }): Uint8Array;
    generate(options: { type: 'nodestring'; compression?: 'DEFLATE' | 'STORE' }): string;
    files: Record<string, unknown>;
  }
}

declare module 'docxtemplater' {
  export default class Docxtemplater {
    constructor(
      zip: unknown,
      options?: {
        modules?: unknown[];
        parser?: unknown;
        paragraphLoop?: boolean;
        linebreaks?: boolean;
        errorLogging?: boolean;
      },
    );
    renderAsync(data: unknown): Promise<unknown>;
    getZip(): {
      generate(options: { type: 'uint8array'; compression?: 'DEFLATE' | 'STORE' }): Uint8Array;
    };
  }
}

declare module 'docxtemplater/expressions.js' {
  const expressionParser: unknown;
  export default expressionParser;
}

declare module '@slosarek/docxtemplater-image-module-free' {
  export default class ImageModule {
    constructor(options: {
      centered: boolean;
      fileType: 'docx' | 'pptx';
      getImage: (tagValue: unknown, tagName: string) => Promise<Uint8Array> | Uint8Array;
      getSize: (image: Uint8Array, tagValue: unknown, tagName: string) => [number, number];
    });
  }
}
