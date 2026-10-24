const API = "https://api.instabox.sh/v1/machines";

async function call(env, action, body) {
  const response = await fetch(`${API}/${env.INSTABOX_MACHINE}/${action}`, {
    method: "POST",
    headers: {
      "X-API-Key": env.INSTABOX_API_KEY,
      "Content-Type": "application/json",
      "User-Agent": "instabox-keepalive-worker/1.0",
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${action} failed with ${response.status}: ${text.slice(0, 300)}`);
  }
  return text;
}

async function keepalive(env) {
  // wake is a no-op while the box is running. If InstaBox paused it for
  // idleness, wake resumes it and waits for the box to be ready.
  await call(env, "wake", {});
  // exec is the terminal activity that resets the 30-minute idle timer.
  await call(env, "exec", { cmd: "true" });
}

export default {
  async scheduled(_controller, env, _ctx) {
    await keepalive(env);
  },

  async fetch(request, env) {
    // Optional manual trigger. The endpoint is public, so it is protected by a
    // separate secret and returns 404 for every other request.
    const token = request.headers.get("x-keepalive-token");
    if (request.method === "POST" && token && token === env.KEEPALIVE_TRIGGER_TOKEN) {
      await keepalive(env);
      return new Response("ok\n", { status: 200 });
    }
    return new Response("Not found", { status: 404 });
  },
};
