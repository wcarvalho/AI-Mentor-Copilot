import { readdir, readFile, writeFile, mkdir, unlink, rename, copyFile } from "fs/promises";
import { join } from "path";

const PORT = 3001;
const TESTS_DIR = join(import.meta.dir, "tests");
const SESSIONS_DIR = join(import.meta.dir, "sessions");
const PLANNING_DIR = join(SESSIONS_DIR, "planning");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // POST /api/process — run claude -p
    if (req.method === "POST" && url.pathname === "/api/process") {
      try {
        const { prompt, systemPrompt, model, allowedTools } = (await req.json()) as {
          prompt: string;
          systemPrompt?: string;
          model?: string;
          allowedTools?: string[];
        };

        const start = Date.now();

        const args = ["claude", "-p", "--output-format", "json", "--no-session-persistence"];
        if (systemPrompt) args.push("--system-prompt", systemPrompt);
        if (model) args.push("--model", model);
        if (allowedTools?.length) args.push("--allowedTools", allowedTools.join(","));

        const proc = Bun.spawn(args, {
          stdin: "pipe",
          stdout: "pipe",
          stderr: "pipe",
        });

        proc.stdin.write(prompt);
        proc.stdin.end();

        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        await proc.exited;

        // Extract result from claude's JSON output
        let output = stdout;
        try {
          const parsed = JSON.parse(stdout);
          output = parsed.result || stdout;
        } catch {
          // If JSON parse fails, use raw stdout
        }

        return Response.json(
          { output, durationMs: Date.now() - start, stderr: stderr || undefined },
          { headers: CORS_HEADERS }
        );
      } catch (err) {
        return Response.json(
          { error: String(err), output: "", durationMs: 0 },
          { status: 500, headers: CORS_HEADERS }
        );
      }
    }

    // GET /api/tests — list test folders
    if (req.method === "GET" && url.pathname === "/api/tests") {
      try {
        const entries = await readdir(TESTS_DIR, { withFileTypes: true });
        const folders = entries
          .filter((e) => e.isDirectory())
          .map((e) => e.name)
          .sort();
        return Response.json({ folders }, { headers: CORS_HEADERS });
      } catch {
        return Response.json({ folders: [] }, { headers: CORS_HEADERS });
      }
    }

    // GET /api/tests/:name — read notes from a test folder
    if (req.method === "GET" && url.pathname.startsWith("/api/tests/")) {
      const name = url.pathname.slice("/api/tests/".length);
      const dir = join(TESTS_DIR, name);

      try {
        const entries = await readdir(dir);
        const noteFiles = entries
          .filter((f) => f.endsWith(".txt") || f.endsWith(".md"))
          .sort();

        const notes = await Promise.all(
          noteFiles.map(async (f) => ({
            text: await readFile(join(dir, f), "utf-8"),
            label: f.replace(/\.(txt|md)$/, ""),
          }))
        );

        return Response.json({ notes }, { headers: CORS_HEADERS });
      } catch {
        return Response.json(
          { error: `Test folder "${name}" not found` },
          { status: 404, headers: CORS_HEADERS }
        );
      }
    }

    // POST /api/sessions — save a session
    if (req.method === "POST" && url.pathname === "/api/sessions") {
      try {
        const session = await req.json();
        const name = session.name || `session-${Date.now()}`;
        const filename = name.replace(/[^a-zA-Z0-9_-]/g, "_") + ".json";
        await mkdir(SESSIONS_DIR, { recursive: true });
        await writeFile(
          join(SESSIONS_DIR, filename),
          JSON.stringify(session, null, 2)
        );
        return Response.json({ saved: filename }, { headers: CORS_HEADERS });
      } catch (err) {
        return Response.json(
          { error: String(err) },
          { status: 500, headers: CORS_HEADERS }
        );
      }
    }

    // GET /api/sessions — list saved sessions
    if (req.method === "GET" && url.pathname === "/api/sessions") {
      try {
        const entries = await readdir(SESSIONS_DIR);
        const sessions = entries
          .filter((f) => f.endsWith(".json"))
          .sort()
          .reverse();
        return Response.json({ sessions }, { headers: CORS_HEADERS });
      } catch {
        return Response.json({ sessions: [] }, { headers: CORS_HEADERS });
      }
    }

    // GET /api/sessions/:name — load a session
    if (req.method === "GET" && url.pathname.startsWith("/api/sessions/")) {
      const name = url.pathname.slice("/api/sessions/".length);
      try {
        const content = await readFile(join(SESSIONS_DIR, name), "utf-8");
        return new Response(content, {
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      } catch {
        return Response.json(
          { error: `Session "${name}" not found` },
          { status: 404, headers: CORS_HEADERS }
        );
      }
    }

    // DELETE /api/sessions/:name — delete a session
    if (req.method === "DELETE" && url.pathname.startsWith("/api/sessions/")) {
      const name = url.pathname.slice("/api/sessions/".length);
      try {
        await unlink(join(SESSIONS_DIR, name));
        return Response.json({ deleted: name }, { headers: CORS_HEADERS });
      } catch {
        return Response.json(
          { error: `Session "${name}" not found` },
          { status: 404, headers: CORS_HEADERS }
        );
      }
    }

    // PUT /api/planning/:key — save planning chat state
    if (req.method === "PUT" && url.pathname.startsWith("/api/planning/")) {
      const key = decodeURIComponent(url.pathname.slice("/api/planning/".length));
      const filename = key.replace(/[^a-zA-Z0-9_-]/g, "_") + ".json";
      try {
        const data = await req.json();
        await mkdir(PLANNING_DIR, { recursive: true });
        await writeFile(join(PLANNING_DIR, filename), JSON.stringify(data));
        return Response.json({ saved: filename }, { headers: CORS_HEADERS });
      } catch (err) {
        return Response.json(
          { error: String(err) },
          { status: 500, headers: CORS_HEADERS }
        );
      }
    }

    // POST /api/planning/rename — rename planning files when session name changes
    if (req.method === "POST" && url.pathname === "/api/planning/rename") {
      try {
        const { oldPrefix, newPrefix } = (await req.json()) as { oldPrefix: string; newPrefix: string };
        await mkdir(PLANNING_DIR, { recursive: true });
        const entries = await readdir(PLANNING_DIR).catch(() => [] as string[]);
        const oldSafe = oldPrefix.replace(/[^a-zA-Z0-9_-]/g, "_");
        const newSafe = newPrefix.replace(/[^a-zA-Z0-9_-]/g, "_");
        let renamed = 0;
        for (const file of entries) {
          if (file.startsWith(oldSafe)) {
            const newName = newSafe + file.slice(oldSafe.length);
            await rename(join(PLANNING_DIR, file), join(PLANNING_DIR, newName));
            renamed++;
          }
        }
        return Response.json({ renamed }, { headers: CORS_HEADERS });
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 500, headers: CORS_HEADERS });
      }
    }

    // POST /api/planning/copy — copy planning files (for session duplicate)
    if (req.method === "POST" && url.pathname === "/api/planning/copy") {
      try {
        const { oldPrefix, newPrefix } = (await req.json()) as { oldPrefix: string; newPrefix: string };
        await mkdir(PLANNING_DIR, { recursive: true });
        const entries = await readdir(PLANNING_DIR).catch(() => [] as string[]);
        const oldSafe = oldPrefix.replace(/[^a-zA-Z0-9_-]/g, "_");
        const newSafe = newPrefix.replace(/[^a-zA-Z0-9_-]/g, "_");
        let copied = 0;
        for (const file of entries) {
          if (file.startsWith(oldSafe)) {
            const newName = newSafe + file.slice(oldSafe.length);
            await copyFile(join(PLANNING_DIR, file), join(PLANNING_DIR, newName));
            copied++;
          }
        }
        return Response.json({ copied }, { headers: CORS_HEADERS });
      } catch (err) {
        return Response.json({ error: String(err) }, { status: 500, headers: CORS_HEADERS });
      }
    }

    // DELETE /api/planning/:key — delete planning chat state
    if (req.method === "DELETE" && url.pathname.startsWith("/api/planning/")) {
      const key = url.pathname.slice("/api/planning/".length);
      const filename = decodeURIComponent(key).replace(/[^a-zA-Z0-9_-]/g, "_") + ".json";
      try {
        await unlink(join(PLANNING_DIR, filename));
        return Response.json({ deleted: filename }, { headers: CORS_HEADERS });
      } catch {
        return Response.json({ deleted: filename }, { headers: CORS_HEADERS });
      }
    }

    // GET /api/planning/:key — load planning chat state
    if (req.method === "GET" && url.pathname.startsWith("/api/planning/")) {
      const key = decodeURIComponent(url.pathname.slice("/api/planning/".length));
      const filename = key.replace(/[^a-zA-Z0-9_-]/g, "_") + ".json";
      try {
        const content = await readFile(join(PLANNING_DIR, filename), "utf-8");
        return new Response(content, {
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      } catch {
        return Response.json(null, { status: 404, headers: CORS_HEADERS });
      }
    }

    return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
  },
});

console.log(`Lab server running on http://localhost:${PORT}`);
