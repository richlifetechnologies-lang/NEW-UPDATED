/**
 * admin-railway.ts — Railway deployment monitoring & redeploy proxy.
 *
 * Proxies Railway GraphQL API calls server-side so the token never
 * reaches the browser. Requires env vars:
 *   RAILWAY_TOKEN      — Railway API token
 *   RAILWAY_PROJECT_ID — Railway project UUID
 *
 * Routes (all require admin auth):
 *   GET  /admin/railway/status      — latest deployment status per service
 *   GET  /admin/railway/deployments — recent deployments list
 *   POST /admin/railway/redeploy    — trigger redeploy of a deployment
 */

import { Router } from "express";
import { requireAdmin } from "../lib/auth";
import { logger } from "../lib/logger";

const router = Router();

const RAILWAY_GQL = "https://backboard.railway.com/graphql/v2";
const RAILWAY_TOKEN = process.env["RAILWAY_TOKEN"] ?? "";
const RAILWAY_PROJECT_ID = process.env["RAILWAY_PROJECT_ID"] ?? "2ba336f7-3178-49fb-983a-2091d509dbfd";

async function railwayGql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(RAILWAY_GQL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RAILWAY_TOKEN}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Railway API ${res.status}: ${text}`);
  }
  const json = await res.json() as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) {
    throw new Error(json.errors.map(e => e.message).join("; "));
  }
  return json.data as T;
}

// ── GET /admin/railway/status ─────────────────────────────────────────────────
router.get("/status", requireAdmin, async (_req, res) => {
  if (!RAILWAY_TOKEN) {
    res.status(503).json({ error: "RAILWAY_TOKEN not configured on this server." });
    return;
  }
  try {
    const data = await railwayGql<any>(`
      query ProjectStatus($projectId: String!) {
        project(id: $projectId) {
          id
          name
          services {
            edges {
              node {
                id
                name
                deployments(first: 1) {
                  edges {
                    node {
                      id
                      status
                      createdAt
                      updatedAt
                      meta
                    }
                  }
                }
              }
            }
          }
        }
      }
    `, { projectId: RAILWAY_PROJECT_ID });

    const project = data?.project;
    const services = (project?.services?.edges ?? []).map((e: any) => {
      const svc = e.node;
      const dep = svc.deployments?.edges?.[0]?.node ?? null;
      return {
        serviceId: svc.id,
        serviceName: svc.name,
        latestDeployment: dep ? {
          deploymentId: dep.id,
          status: dep.status,
          createdAt: dep.createdAt,
          updatedAt: dep.updatedAt,
        } : null,
      };
    });

    res.json({
      projectId: RAILWAY_PROJECT_ID,
      projectName: project?.name ?? null,
      services,
      queriedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "[Railway] status query failed");
    res.status(500).json({ error: String(err) });
  }
});

// ── GET /admin/railway/deployments ────────────────────────────────────────────
router.get("/deployments", requireAdmin, async (req, res) => {
  if (!RAILWAY_TOKEN) {
    res.status(503).json({ error: "RAILWAY_TOKEN not configured on this server." });
    return;
  }
  try {
    const limit = Math.min(parseInt(String(req.query["limit"] ?? "10"), 10), 50);
    const data = await railwayGql<any>(`
      query Deployments($projectId: String!) {
        deployments(input: { projectId: $projectId }, first: 20) {
          edges {
            node {
              id
              status
              createdAt
              updatedAt
              meta
              service {
                id
                name
              }
            }
          }
        }
      }
    `, { projectId: RAILWAY_PROJECT_ID });

    const deployments = (data?.deployments?.edges ?? [])
      .slice(0, limit)
      .map((e: any) => ({
        deploymentId: e.node.id,
        status: e.node.status,
        createdAt: e.node.createdAt,
        updatedAt: e.node.updatedAt,
        serviceId: e.node.service?.id ?? null,
        serviceName: e.node.service?.name ?? null,
        commitMessage: e.node.meta?.commitMessage ?? null,
        commitHash: e.node.meta?.commitHash ?? null,
        branch: e.node.meta?.branch ?? null,
      }));

    res.json({ deployments, projectId: RAILWAY_PROJECT_ID });
  } catch (err) {
    logger.error({ err }, "[Railway] deployments query failed");
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /admin/railway/redeploy ──────────────────────────────────────────────
router.post("/redeploy", requireAdmin, async (req, res) => {
  if (!RAILWAY_TOKEN) {
    res.status(503).json({ error: "RAILWAY_TOKEN not configured on this server." });
    return;
  }
  const { deploymentId } = req.body as { deploymentId?: string };
  if (!deploymentId) {
    res.status(400).json({ error: "deploymentId is required" });
    return;
  }
  try {
    const data = await railwayGql<any>(`
      mutation Redeploy($deploymentId: String!) {
        deploymentRedeploy(id: $deploymentId) {
          id
          status
        }
      }
    `, { deploymentId });

    const newDeploy = data?.deploymentRedeploy;
    logger.info({ deploymentId, newDeployId: newDeploy?.id }, "[Railway] redeploy triggered");
    res.json({
      ok: true,
      newDeploymentId: newDeploy?.id ?? null,
      status: newDeploy?.status ?? null,
    });
  } catch (err) {
    logger.error({ err }, "[Railway] redeploy failed");
    res.status(500).json({ error: String(err) });
  }
});

export default router;
