import { internalAction, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const PRODUCT_HUNT_URL = "https://www.producthunt.com/posts/flaresat";

// ─── Helpers ────────────────────────────────────────────────────────────────

async function sendPushNotifications(
  tokens: string[],
  message: { title: string; body: string; data?: Record<string, string> }
) {
  if (tokens.length === 0) return;

  // Expo accepts up to 100 messages per batch
  const chunks: string[][] = [];
  for (let i = 0; i < tokens.length; i += 100) {
    chunks.push(tokens.slice(i, i + 100));
  }

  await Promise.all(
    chunks.map((chunk) =>
      fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          chunk.map((token) => ({
            to: token,
            title: message.title,
            body: message.body,
            data: message.data ?? {},
            sound: "default",
          }))
        ),
      })
    )
  );
}

async function sendEmail(to: string, name: string, resendApiKey: string) {
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Adrien from Flaresat <adrien@flaresat.com>",
      to,
      subject: "Flaresat is live on Product Hunt — would you vote for us? 🙏",
      html: `
        <p>Hey ${name},</p>

        <p>
          We just went live on Product Hunt! It would mean the world to us
          if you could take 10 seconds to support Flaresat with a vote.
        </p>

        <p>
          <a href="${PRODUCT_HUNT_URL}" style="font-weight:bold;">
            👉 Vote for Flaresat on Product Hunt
          </a>
        </p>

        <p>
          You're one of our earliest users and your support genuinely matters.
          Thank you so much!
        </p>

        <p>
          — Adrien &amp; the Flaresat team
        </p>
      `,
    }),
  });
}

// ─── Internal query ──────────────────────────────────────────────────────────

export const getUsersForVoteRequest = internalQuery({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    return users.map((u) => ({
      email: u.email as string | undefined,
      name: (u.name ?? u.email ?? "there") as string,
      pushToken: u.expoPushToken as string | undefined,
    }));
  },
});

// ─── Main action ─────────────────────────────────────────────────────────────

export const sendVoteRequest = internalAction({
  args: {},
  handler: async (ctx) => {
    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) throw new Error("RESEND_API_KEY is not set");

    const users = await ctx.runQuery(
      internal.sendVoteRequest.getUsersForVoteRequest
    );

    const pushTokens = users
      .map((u) => u.pushToken)
      .filter((t): t is string => !!t);

    const emailUsers = users.filter((u) => !!u.email);

    await Promise.all([
      // Push notifications (batched)
      sendPushNotifications(pushTokens, {
        title: "Flaresat is live on Product Hunt! 🚀",
        body: "Tap to vote for us — it only takes a second and means a lot 🙏",
        data: { url: PRODUCT_HUNT_URL },
      }),

      // Emails (parallel, one per user)
      ...emailUsers.map((u) => sendEmail(u.email!, u.name, resendApiKey)),
    ]);

    console.log(
      `Vote request sent: ${pushTokens.length} push, ${emailUsers.length} email`
    );
  },
});
