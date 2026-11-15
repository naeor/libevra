/**
 * 浏览器里的 raw deflate（给 `@libellum/shared` 的 `buildZipAsync` 注入）。
 *
 * 用 `CompressionStream("deflate-raw")`；浏览器不支持或压缩出错时返回 `null`，
 * shared 会把该条目“只存储不压缩”——文件大一些，但任何读取器都能打开。
 */
export async function deflateRawBrowser(raw: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === "undefined" || typeof ReadableStream === "undefined") return null;
  try {
    const source = new ReadableStream<BufferSource>({
      start(controller) {
        controller.enqueue(raw as Uint8Array<ArrayBuffer>);
        controller.close();
      },
    });
    const compressed = source.pipeThrough(new CompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(compressed).arrayBuffer());
  } catch {
    return null;
  }
}
