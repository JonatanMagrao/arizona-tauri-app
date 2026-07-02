import { zlib } from "../../../../../lib/cep/node";

export interface PsdPreview {
  dataUrl: string;
  width: number;
  height: number;
}

interface PsdHeader {
  version: number;
  channels: number;
  width: number;
  height: number;
  depth: number;
  colorMode: number;
}

interface DecodedPsd {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

class BinaryCursor {
  private view: DataView;

  offset = 0;

  constructor(private bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get length() {
    return this.bytes.length;
  }

  remaining() {
    return this.length - this.offset;
  }

  skip(length: number) {
    this.assert(length);
    this.offset += length;
  }

  uint8() {
    this.assert(1);
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  uint16() {
    this.assert(2);
    const value = this.view.getUint16(this.offset, false);
    this.offset += 2;
    return value;
  }

  uint32() {
    this.assert(4);
    const value = this.view.getUint32(this.offset, false);
    this.offset += 4;
    return value;
  }

  ascii(length: number) {
    this.assert(length);
    let value = "";

    for (let index = 0; index < length; index += 1) {
      value += String.fromCharCode(this.bytes[this.offset + index]);
    }

    this.offset += length;
    return value;
  }

  slice(start: number, end: number) {
    if (start < 0 || end > this.length || start > end) {
      throw new Error("PSD corrompido.");
    }

    return this.bytes.subarray(start, end);
  }

  private assert(length: number) {
    if (this.offset + length > this.length) {
      throw new Error("PSD incompleto.");
    }
  }
}

const toUint8Array = (input: ArrayBuffer | Uint8Array) =>
  input instanceof Uint8Array ? input : new Uint8Array(input);

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
};

const readHeader = (cursor: BinaryCursor): PsdHeader => {
  if (cursor.ascii(4) !== "8BPS") {
    throw new Error("Arquivo PSD invalido.");
  }

  const version = cursor.uint16();

  if (version !== 1 && version !== 2) {
    throw new Error("Versao PSD nao suportada.");
  }

  cursor.skip(6);

  const channels = cursor.uint16();
  const height = cursor.uint32();
  const width = cursor.uint32();
  const depth = cursor.uint16();
  const colorMode = cursor.uint16();

  if (channels <= 0 || width <= 0 || height <= 0) {
    throw new Error("PSD sem dimensoes validas.");
  }

  return {
    version,
    channels,
    width,
    height,
    depth,
    colorMode,
  };
};

const skipToImageResources = (cursor: BinaryCursor) => {
  const colorModeDataLength = cursor.uint32();
  cursor.skip(colorModeDataLength);
};

const skipToCompositeImage = (cursor: BinaryCursor) => {
  skipToImageResources(cursor);
  const imageResourceLength = cursor.uint32();
  cursor.skip(imageResourceLength);
  const layerMaskLength = cursor.uint32();
  cursor.skip(layerMaskLength);
};

const parseThumbnailResource = (bytes: Uint8Array): PsdPreview | undefined => {
  const cursor = new BinaryCursor(bytes);

  if (cursor.remaining() < 28) {
    return undefined;
  }

  const format = cursor.uint32();
  const width = cursor.uint32();
  const height = cursor.uint32();

  cursor.uint32();
  cursor.uint32();

  const compressedSize = cursor.uint32();
  cursor.uint16();
  cursor.uint16();

  if (compressedSize <= 0 || cursor.remaining() < compressedSize) {
    return undefined;
  }

  const imageBytes = cursor.slice(cursor.offset, cursor.offset + compressedSize);

  if (format === 1) {
    return {
      dataUrl: `data:image/jpeg;base64,${bytesToBase64(imageBytes)}`,
      width,
      height,
    };
  }

  return undefined;
};

export const extractPsdThumbnailPreview = (
  input: ArrayBuffer | Uint8Array
): PsdPreview | undefined => {
  const bytes = toUint8Array(input);
  const cursor = new BinaryCursor(bytes);

  readHeader(cursor);
  skipToImageResources(cursor);

  const resourceLength = cursor.uint32();
  const resourceEnd = cursor.offset + resourceLength;

  if (resourceEnd > cursor.length) {
    throw new Error("PSD com recursos incompletos.");
  }

  while (cursor.offset + 12 <= resourceEnd) {
    const signature = cursor.ascii(4);

    if (signature !== "8BIM" && signature !== "8B64") {
      break;
    }

    const resourceId = cursor.uint16();
    const nameLength = cursor.uint8();
    cursor.skip(nameLength);

    if ((nameLength + 1) % 2 !== 0) {
      cursor.skip(1);
    }

    const dataLength = cursor.uint32();
    const dataStart = cursor.offset;
    const dataEnd = dataStart + dataLength;

    if (dataEnd > resourceEnd) {
      throw new Error("PSD com thumbnail incompleta.");
    }

    if (resourceId === 1033 || resourceId === 1036) {
      const preview = parseThumbnailResource(cursor.slice(dataStart, dataEnd));

      if (preview) {
        return preview;
      }
    }

    cursor.offset = dataEnd;

    if (dataLength % 2 !== 0) {
      cursor.skip(1);
    }
  }

  return undefined;
};

const normalizeChannel = (
  bytes: Uint8Array,
  depth: number,
  pixelCount: number
) => {
  if (depth === 8) {
    return bytes.slice(0, pixelCount);
  }

  const channel = new Uint8Array(pixelCount);

  for (let index = 0; index < pixelCount; index += 1) {
    channel[index] = bytes[index * 2] ?? 0;
  }

  return channel;
};

const decodePackBits = (source: Uint8Array, expectedLength: number) => {
  const output = new Uint8Array(expectedLength);
  let inputOffset = 0;
  let outputOffset = 0;

  while (inputOffset < source.length && outputOffset < expectedLength) {
    let header = source[inputOffset];
    inputOffset += 1;

    if (header > 127) {
      header -= 256;
    }

    if (header >= 0) {
      const count = Math.min(header + 1, expectedLength - outputOffset);
      output.set(source.subarray(inputOffset, inputOffset + count), outputOffset);
      inputOffset += count;
      outputOffset += count;
      continue;
    }

    if (header >= -127) {
      const count = Math.min(1 - header, expectedLength - outputOffset);
      const value = source[inputOffset] ?? 0;
      inputOffset += 1;
      output.fill(value, outputOffset, outputOffset + count);
      outputOffset += count;
    }
  }

  return output;
};

const readRawChannels = (
  cursor: BinaryCursor,
  header: PsdHeader,
  bytesPerSample: number,
  pixelCount: number
) => {
  const channels: Uint8Array[] = [];
  const channelByteLength = pixelCount * bytesPerSample;

  for (let channelIndex = 0; channelIndex < header.channels; channelIndex += 1) {
    const start = cursor.offset;
    const end = start + channelByteLength;
    const channelBytes = cursor.slice(start, end);
    channels.push(normalizeChannel(channelBytes, header.depth, pixelCount));
    cursor.offset = end;
  }

  return channels;
};

const readRleChannels = (
  cursor: BinaryCursor,
  header: PsdHeader,
  bytesPerSample: number,
  pixelCount: number
) => {
  const rowCount = header.channels * header.height;
  const rowLengthSize = header.version === 2 ? 4 : 2;
  const rowLengths: number[] = [];

  for (let index = 0; index < rowCount; index += 1) {
    rowLengths.push(rowLengthSize === 4 ? cursor.uint32() : cursor.uint16());
  }

  const channels = Array.from(
    { length: header.channels },
    () => new Uint8Array(pixelCount)
  );
  const rowByteLength = header.width * bytesPerSample;

  for (let channelIndex = 0; channelIndex < header.channels; channelIndex += 1) {
    for (let rowIndex = 0; rowIndex < header.height; rowIndex += 1) {
      const lengthIndex = channelIndex * header.height + rowIndex;
      const compressedLength = rowLengths[lengthIndex] ?? 0;
      const start = cursor.offset;
      const end = start + compressedLength;
      const decodedRow = decodePackBits(cursor.slice(start, end), rowByteLength);
      const rowOffset = rowIndex * header.width;

      if (header.depth === 8) {
        channels[channelIndex].set(decodedRow.subarray(0, header.width), rowOffset);
      } else {
        for (let columnIndex = 0; columnIndex < header.width; columnIndex += 1) {
          channels[channelIndex][rowOffset + columnIndex] =
            decodedRow[columnIndex * 2] ?? 0;
        }
      }

      cursor.offset = end;
    }
  }

  return channels;
};

const inflateZipData = (bytes: Uint8Array) => {
  if (typeof zlib.inflateSync !== "function") {
    throw new Error("ZIP do PSD indisponivel neste ambiente.");
  }

  return new Uint8Array(zlib.inflateSync(Buffer.from(bytes)));
};

const restoreZipPrediction = (
  bytes: Uint8Array,
  header: PsdHeader,
  bytesPerSample: number
) => {
  const restored = new Uint8Array(bytes);
  const channelByteLength = header.width * header.height * bytesPerSample;
  const rowByteLength = header.width * bytesPerSample;

  for (let channelIndex = 0; channelIndex < header.channels; channelIndex += 1) {
    const channelStart = channelIndex * channelByteLength;

    for (let rowIndex = 0; rowIndex < header.height; rowIndex += 1) {
      const rowStart = channelStart + rowIndex * rowByteLength;
      const rowEnd = rowStart + rowByteLength;

      if (header.depth === 8) {
        for (let index = rowStart + 1; index < rowEnd; index += 1) {
          restored[index] = (restored[index] + restored[index - 1]) & 255;
        }

        continue;
      }

      for (let index = rowStart + 2; index < rowEnd; index += 2) {
        const current = (restored[index] << 8) | restored[index + 1];
        const previous = (restored[index - 2] << 8) | restored[index - 1];
        const value = (current + previous) & 65535;

        restored[index] = value >> 8;
        restored[index + 1] = value & 255;
      }
    }
  }

  return restored;
};

const readZipChannels = (
  cursor: BinaryCursor,
  header: PsdHeader,
  bytesPerSample: number,
  pixelCount: number,
  hasPrediction: boolean
) => {
  const compressedBytes = cursor.slice(cursor.offset, cursor.length);
  const inflatedBytes = inflateZipData(compressedBytes);
  const restoredBytes = hasPrediction
    ? restoreZipPrediction(inflatedBytes, header, bytesPerSample)
    : inflatedBytes;

  return readRawChannels(
    new BinaryCursor(restoredBytes),
    header,
    bytesPerSample,
    pixelCount
  );
};

const ensureSupportedComposite = (header: PsdHeader) => {
  if (header.depth !== 8 && header.depth !== 16) {
    throw new Error("PSD com profundidade nao suportada.");
  }

  if (![1, 3, 4].includes(header.colorMode)) {
    throw new Error("PSD com modo de cor nao suportado.");
  }
};

const channelValue = (
  channels: Uint8Array[],
  channelIndex: number,
  pixelIndex: number,
  fallback: number
) => channels[channelIndex]?.[pixelIndex] ?? fallback;

const composeChannels = (header: PsdHeader, channels: Uint8Array[]) => {
  const pixelCount = header.width * header.height;
  const output = new Uint8ClampedArray(pixelCount * 4);

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const outputIndex = pixelIndex * 4;

    if (header.colorMode === 1) {
      const gray = channelValue(channels, 0, pixelIndex, 0);
      output[outputIndex] = gray;
      output[outputIndex + 1] = gray;
      output[outputIndex + 2] = gray;
      output[outputIndex + 3] = channelValue(channels, 1, pixelIndex, 255);
      continue;
    }

    if (header.colorMode === 4) {
      const cyan = channelValue(channels, 0, pixelIndex, 0);
      const magenta = channelValue(channels, 1, pixelIndex, 0);
      const yellow = channelValue(channels, 2, pixelIndex, 0);
      const black = channelValue(channels, 3, pixelIndex, 0);

      output[outputIndex] = 255 - Math.min(255, cyan + black);
      output[outputIndex + 1] = 255 - Math.min(255, magenta + black);
      output[outputIndex + 2] = 255 - Math.min(255, yellow + black);
      output[outputIndex + 3] = channelValue(channels, 4, pixelIndex, 255);
      continue;
    }

    output[outputIndex] = channelValue(channels, 0, pixelIndex, 0);
    output[outputIndex + 1] = channelValue(channels, 1, pixelIndex, 0);
    output[outputIndex + 2] = channelValue(channels, 2, pixelIndex, 0);
    output[outputIndex + 3] = channelValue(channels, 3, pixelIndex, 255);
  }

  return output;
};

const decodePsdComposite = (input: ArrayBuffer | Uint8Array): DecodedPsd => {
  const bytes = toUint8Array(input);
  const cursor = new BinaryCursor(bytes);
  const header = readHeader(cursor);

  ensureSupportedComposite(header);
  skipToCompositeImage(cursor);

  const compression = cursor.uint16();
  const pixelCount = header.width * header.height;
  const bytesPerSample = header.depth === 16 ? 2 : 1;

  let channels: Uint8Array[];

  if (compression === 0) {
    channels = readRawChannels(cursor, header, bytesPerSample, pixelCount);
  } else if (compression === 1) {
    channels = readRleChannels(cursor, header, bytesPerSample, pixelCount);
  } else if (compression === 2 || compression === 3) {
    channels = readZipChannels(
      cursor,
      header,
      bytesPerSample,
      pixelCount,
      compression === 3
    );
  } else {
    throw new Error("PSD com compressao nao suportada.");
  }

  return {
    width: header.width,
    height: header.height,
    data: composeChannels(header, channels),
  };
};

const imageDataToPreview = (decoded: DecodedPsd, maxSide: number): PsdPreview => {
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = decoded.width;
  sourceCanvas.height = decoded.height;

  const sourceContext = sourceCanvas.getContext("2d");

  if (!sourceContext) {
    throw new Error("Canvas indisponivel.");
  }

  const imageData = sourceContext.createImageData(decoded.width, decoded.height);
  imageData.data.set(decoded.data);
  sourceContext.putImageData(imageData, 0, 0);

  const scale = Math.min(1, maxSide / Math.max(decoded.width, decoded.height));

  if (scale === 1) {
    return {
      dataUrl: sourceCanvas.toDataURL("image/png"),
      width: decoded.width,
      height: decoded.height,
    };
  }

  const targetCanvas = document.createElement("canvas");
  targetCanvas.width = Math.max(1, Math.round(decoded.width * scale));
  targetCanvas.height = Math.max(1, Math.round(decoded.height * scale));

  const targetContext = targetCanvas.getContext("2d");

  if (!targetContext) {
    throw new Error("Canvas indisponivel.");
  }

  targetContext.imageSmoothingEnabled = true;
  targetContext.imageSmoothingQuality = "high";
  targetContext.drawImage(
    sourceCanvas,
    0,
    0,
    targetCanvas.width,
    targetCanvas.height
  );

  return {
    dataUrl: targetCanvas.toDataURL("image/png"),
    width: decoded.width,
    height: decoded.height,
  };
};

export const renderPsdCompositePreview = (
  input: ArrayBuffer | Uint8Array,
  maxSide = 1800
) => imageDataToPreview(decodePsdComposite(input), maxSide);
