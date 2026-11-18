import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 8787);

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/report") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
    return;
  }

  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);

  try {
    const report = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    console.log(
      JSON.stringify(
        {
          runId: report.run?.id,
          status: report.run?.status,
          summary: report.summary,
          tests: report.tests?.map((test) => ({
            title: test.title,
            status: test.status,
            outcome: test.outcome,
            attempts: test.attempts?.length,
          })),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error("invalid JSON payload:", error);
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "invalid json" }));
    return;
  }

  response.writeHead(204);
  response.end();
});

server.listen(port, "127.0.0.1", () => {
  console.log(`report server listening on http://127.0.0.1:${port}/report`);
});
