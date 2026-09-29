// 按 SSE 行协议解码，允许任意字节分片、CRLF、多行 data 和注释心跳。
export async function* readSSE(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  let frameLength = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        if (line === "") {
          if (data.length) yield data.join("\n");
          data = [];
          frameLength = 0;
        } else if (line.startsWith("data:")) {
          frameLength += line.length;
          if (frameLength > 2_000_000)
            throw new Error("SSE frame exceeds size limit");
          data.push(line.slice(5).replace(/^ /, ""));
        }
      }
      if (buffer.length > 2_000_000)
        throw new Error("SSE frame exceeds size limit");
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
