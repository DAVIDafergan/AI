import { connectToDB } from "../../lib/mongodb";
import { Tenant } from "../../lib/db";
import DashboardClient from "./DashboardClient";

const toISO = (d) => (d instanceof Date ? d.toISOString() : null);

export default async function DashboardPage() {
  let clients = [];
  try {
    await connectToDB();
    const raw = await Tenant.find({}).lean();
    // Serialize MongoDB documents so they are safe to pass to a Client Component
    clients = raw.map((c) => ({
      ...c,
      _id: c._id.toString(),
      createdAt: toISO(c.createdAt),
      updatedAt: toISO(c.updatedAt),
      usage: c.usage
        ? { ...c.usage, lastActivity: toISO(c.usage.lastActivity) }
        : undefined,
    }));
  } catch (err) {
    console.error("[DashboardPage] Failed to load clients:", err.message);
  }

  return <DashboardClient initialClients={clients} />;
}
