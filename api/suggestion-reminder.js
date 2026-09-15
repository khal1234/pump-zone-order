import { list } from "@vercel/blob";

export default async function handler(request, response) {
  if (!process.env.CRON_SECRET || request.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return response.status(401).json({ ok: false });
  const { blobs } = await list({ prefix: "suggestions/open/", limit: 200 });
  if (!blobs.length) return response.status(200).json({ ok: true, sent: false, pending: 0 });
  if (!process.env.DISCORD_SUGGESTION_WEBHOOK) return response.status(503).json({ ok: false, error: "Discord webhook is not configured" });
  const discord = await fetch(process.env.DISCORD_SUGGESTION_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "존 파인더 건의함",
      content: `📬 확인하지 않은 익명 건의가 **${blobs.length}건** 있어.\nhttps://pump-zone-order.vercel.app/?admin=feedback`,
      allowed_mentions: { parse: [] },
    }),
  });
  if (!discord.ok) return response.status(502).json({ ok: false, error: "Discord notification failed" });
  return response.status(200).json({ ok: true, sent: true, pending: blobs.length });
}
