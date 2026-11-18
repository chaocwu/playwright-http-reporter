import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 8787);

createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/report") {
    response.writeHead(404).end();
    return;
  }

  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);

  let event;
  try {
    event = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    response.writeHead(400).end("invalid json");
    return;
  }

  const detail =
    event.event === "begin"
      ? `${event.data.totalTests} tests`
      : event.event === "testEnd"
        ? `${event.data.test.title}: ${event.data.result.status}`
        : event.event === "end"
          ? event.data.status
          : event.data.message;

  console.log(`${event.runId.slice(0, 8)} ${event.event} ${detail}`);
  response.writeHead(204).end();
}).listen(port, "127.0.0.1", () => {
  console.log(`listening on http://127.0.0.1:${port}/report`);
});
