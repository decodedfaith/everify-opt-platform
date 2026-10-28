/**
 * ============================================================================
 * E-Verify Platform - Hiring & Enrichment API routes
 * ============================================================================
 *   GET  /api/jobs/search          jobs at E-Verified employers (role search)
 *   GET  /api/employers/:id/jobs   company profile + open roles
 *   POST /api/employers/:id/enrich lazy "find website + roles" for one employer
 *   POST /api/employers/:id/feedback  report a wrong website / jobs
 *   GET  /api/enrichment/stats     headline numbers for the UI
 * ============================================================================
 */

import type { Express, Request, Response } from 'express';
import { enrichEmployerById } from '../../enrichment/enrich-service';
import { addFeedback, enrichmentCounts, getEmployerJobs, searchJobs } from '../../enrichment/store';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SENIORITIES = new Set(['intern', 'entry', 'mid', 'senior']);

function handler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response): void => {
    fn(req, res).catch((err: Error) => {
      console.error('[API ERROR]', req.method, req.originalUrl, err.message);
      res.status(500).json({ success: false, error: 'Internal server error' });
    });
  };
}

export function registerEnrichmentRoutes(app: Express): void {
  app.get(
    '/api/jobs/search',
    handler(async (req, res) => {
      const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
      const stateRaw = typeof req.query.state === 'string' ? req.query.state.trim().toUpperCase() : '';
      const seniorityRaw = typeof req.query.level === 'string' ? req.query.level.trim().toLowerCase() : '';
      const limit = Math.min(Math.max(1, parseInt(req.query.limit as string, 10) || 20), 50);
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);

      const started = process.hrtime.bigint();
      const { rows, total } = await searchJobs({
        q,
        state: /^[A-Z]{2}$/.test(stateRaw) ? stateRaw : undefined,
        seniority: SENIORITIES.has(seniorityRaw) ? seniorityRaw : undefined,
        remote: req.query.remote === '1' || req.query.remote === 'true',
        limit,
        page,
      });
      const ms = Number(process.hrtime.bigint() - started) / 1_000_000;

      res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
      res.json({
        success: true,
        data: rows.map((r) => ({
          id: r.id,
          title: r.title,
          department: r.department,
          location: r.location,
          state: r.state,
          remote: r.remote,
          level: r.seniority,
          applyUrl: r.apply_url,
          postedAt: r.posted_at ? new Date(r.posted_at).toISOString() : null,
          company: {
            domain: r.domain,
            name: r.display_name,
            websiteUrl: r.website_url,
            employerId: r.employer_id,
            legalName: r.employer_name,
          },
        })),
        meta: { total, page, limit, totalPages: Math.ceil(total / limit), executionTimeMs: Math.round(ms * 100) / 100 },
      });
    })
  );

  app.get(
    '/api/employers/:id/jobs',
    handler(async (req, res) => {
      const id = String(req.params.id);
      if (!UUID_RE.test(id)) {
        res.status(400).json({ success: false, error: 'Invalid employer id' });
        return;
      }
      const view = await getEmployerJobs(id);
      res.json({
        success: true,
        data: {
          enrichmentStatus: view.enrichment?.status ?? 'pending',
          confidence: view.enrichment?.confidence ?? 0,
          company: view.profile
            ? {
                domain: view.profile.domain,
                name: view.profile.display_name,
                websiteUrl: view.profile.website_url,
                careersUrl: view.profile.careers_url,
                atsType: view.profile.ats_type,
                jobsSyncedAt: view.profile.jobs_synced_at ? new Date(view.profile.jobs_synced_at).toISOString() : null,
                openRoles: view.profile.ats_type ? view.profile.active_job_count : null,
              }
            : null,
          jobs: view.jobs.map((j) => ({
            id: j.id,
            title: j.title,
            department: j.department,
            location: j.location,
            state: j.state,
            remote: j.remote,
            level: j.seniority,
            applyUrl: j.apply_url,
            postedAt: j.posted_at ? new Date(j.posted_at).toISOString() : null,
          })),
        },
      });
    })
  );

  app.post(
    '/api/employers/:id/enrich',
    handler(async (req, res) => {
      const id = String(req.params.id);
      if (!UUID_RE.test(id)) {
        res.status(400).json({ success: false, error: 'Invalid employer id' });
        return;
      }
      const result = await enrichEmployerById(id);
      if (result.state === 'busy') {
        res.status(429).json({ success: false, error: 'Busy enriching other companies. Try again in a moment.' });
        return;
      }
      if (result.state === 'missing') {
        res.status(404).json({ success: false, error: 'Employer not found' });
        return;
      }
      res.json({ success: true, data: result.outcome });
    })
  );

  app.post(
    '/api/employers/:id/feedback',
    handler(async (req, res) => {
      const id = String(req.params.id);
      const body = (req.body ?? {}) as { kind?: unknown; note?: unknown; domain?: unknown };
      const kind = typeof body.kind === 'string' ? body.kind : '';
      if (!UUID_RE.test(id) || !['wrong_website', 'wrong_jobs', 'suggest_website'].includes(kind)) {
        res.status(400).json({ success: false, error: 'Invalid feedback' });
        return;
      }
      const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : null;
      const domain = typeof body.domain === 'string' ? body.domain.trim().slice(0, 200) : null;
      await addFeedback(id, domain, kind, note || null);
      res.json({ success: true });
    })
  );

  app.get(
    '/api/enrichment/stats',
    handler(async (_req, res) => {
      res.setHeader('Cache-Control', 'public, max-age=60');
      res.json({ success: true, data: await enrichmentCounts() });
    })
  );
}
