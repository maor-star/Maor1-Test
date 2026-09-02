import { describe, expect, it } from 'vitest';
import { loadControlPanel } from '@/lib/control/service';
import { summariseAllPeriods, summariseCompany } from '@/lib/revenue/company';
import { summariseForPeriod } from '@/lib/revenue/period-service';
import { PERIODS } from '@/lib/revenue/periods';
import { topSeats, loadSeats, availableSeatPeriods } from '@/lib/seats/service';
import { clientsToCall, urgentWork } from '@/lib/overview/service';
import { delegatableTeam, delegationCounts, listDelegations } from '@/lib/delegation/module';
import { DELEGATION_VIEWS } from '@/lib/delegation/module';
import { listMail, mailCounts, mailNeedingReply, MAIL_VIEWS } from '@/lib/mail/service';
import {
  captureLabelHealth, contractsForOpportunities, inboxOpportunities,
} from '@/lib/opportunities/module';
import {
  buildBoard, closedCount, listOwners, listPipeline, recentTouches, PIPELINE_SORTS,
} from '@/lib/pipeline/service';
import { STAGES } from '@/lib/pipeline/types';
import { getSubtasks, getTask, listDepartments, listPeople, listTasks } from '@/lib/tasks/queries';
import { listComments } from '@/lib/tasks/mutations';
import { contractBoard, listContracts } from '@/lib/contracts/service';
import { contractCounts, listContracts as listIntake, pendingIntake, suggestLinks } from '@/lib/contracts/intake-module';
import {
  contactsForCompanies, crmFilterOptions, crmSummary, listCompanies, listContacts,
} from '@/lib/crm/queries';
import { companySuggestions } from '@/lib/crm/mutations';
import { conversationsFor } from '@/lib/crm/conversations';
import { conversationsWith, getCompany, getContact } from '@/lib/crm/detail';
import { loadTrading, TRADING_PERIODS } from '@/lib/trading/service';
import { agentsOverview, listAgents, seedAgents } from '@/lib/agents/module';
import { conditions } from '@/lib/agents/checks';
import { settingsContext } from '@/lib/agents/checks';
import { listThreads } from '@/lib/copilot/service';
import { decisionCounts, lastReviewAt, recentDecisions } from '@/lib/copilot/autopilot';
import { taskAttachments } from '@/lib/attachments/service';
import { statusOf } from '@/lib/secrets/store';
import { draftCounts, linkedInReady, listDrafts } from '@/lib/marketing/service';
import { findWins } from '@/lib/marketing/wins';
import { slackReach } from '@/lib/copilot/slack-view';
import { SECRET_KEYS } from '@/lib/secrets/catalogue';

/**
 * Every screen's data, against a real database.
 *
 * This exists because of a bug it would have caught. An array interpolated
 * into hand-written SQL — `= any(${names}::text[])` — becomes a row
 * constructor, which Postgres refuses to cast; the query is syntactically
 * fine in TypeScript and fails only when it runs. It ran on every load of the
 * agents screen, and the first thing that told anyone was the screen being
 * down.
 *
 * So the rule here is coverage, not cleverness: call what each page calls,
 * with the arguments it passes, and let a broken query fail the suite rather
 * than the screen. Assertions are deliberately weak — an empty database is a
 * valid answer everywhere — because what is being tested is that the query
 * executes at all.
 */

const ok = async (label: string, fn: () => Promise<unknown>) => {
  const result = await fn().catch((e: unknown) => {
    throw new Error(`${label} failed: ${e instanceof Error ? e.message : String(e)}`);
  });
  expect(result, label).toBeDefined();
  return result;
};

describe('the overview', () => {
  it('loads the control panel', async () => {
    const panel = (await ok('loadControlPanel', () => loadControlPanel())) as { lines: unknown[] };
    expect(panel.lines).toHaveLength(7);
  });
  it('loads the profit strip, the seats, the work and the mail', async () => {
    await ok('summariseCompany', () => summariseCompany('YESTERDAY'));
    await ok('topSeats', () => topSeats());
    await ok('urgentWork', () => urgentWork(8));
    await ok('clientsToCall', () => clientsToCall(8));
    await ok('mailNeedingReply', () => mailNeedingReply(5));
    await ok('mailCounts', () => mailCounts());
    await ok('listDelegations', () => listDelegations('open'));
    await ok('inboxOpportunities', () => inboxOpportunities());
    await ok('listPipeline attention', () => listPipeline({ attention: true, sort: 'next_step' }));
    await ok('listDepartments', () => listDepartments());
    await ok('listPeople', () => listPeople());
  });
});

describe('the agents screen', () => {
  // The one that broke: seedAgents runs on every load, and its retire query
  // was the query that could not be cast.
  it('seeds, retires and lists without a SQL error', async () => {
    await ok('seedAgents', () => seedAgents('test@adnimation.com'));
    const rows = (await ok('listAgents', () => listAgents())) as { name: string }[];
    expect(rows.length).toBeGreaterThan(0);
    await ok('agentsOverview', () => agentsOverview());
  });

  it('runs every in-app condition the way a run would', async () => {
    for (const [name, check] of Object.entries(conditions)) {
      const context = await settingsContext(name === 'deal_stale' ? 'deal-mover' : 'activity-watch');
      await ok(`condition ${name}`, () => check({}, context));
    }
  });
});

describe('the deals board', () => {
  it('loads every stage, sort and filter', async () => {
    for (const stage of STAGES) await ok(`listPipeline ${stage}`, () => listPipeline({ stage }));
    for (const sort of PIPELINE_SORTS) await ok(`listPipeline ${sort}`, () => listPipeline({ sort }));
    // The finished board is its own query and its own empty state.
    await ok('listPipeline closed', () => listPipeline({ closed: true }));
    await ok('closedCount', () => closedCount());
    const rows = await listPipeline({});
    buildBoard(rows);
    await ok('recentTouches', () => recentTouches(rows.map((r) => r.id)));
    await ok('listOwners', () => listOwners());
    await ok('captureLabelHealth', () => captureLabelHealth(['Opportunity']));
    const inbox = await inboxOpportunities();
    await ok('contractsForOpportunities', () => contractsForOpportunities(inbox.map((o) => o.id)));
  });
});

describe('tasks', () => {
  it('loads the list, and one task whole', async () => {
    const rows = (await ok('listTasks', () => listTasks({ limit: 50 }))) as { id: string }[];
    await ok('listTasks company', () => listTasks({ layer: 'company', limit: 10 }));
    await ok('listTasks search', () => listTasks({ search: 'a', limit: 10 }));
    const first = rows[0];
    if (first) {
      await ok('getTask', () => getTask(first.id));
      await ok('getSubtasks', () => getSubtasks(first.id));
      await ok('listComments', () => listComments(first.id));
      await ok('taskAttachments', () => taskAttachments(first.id));
    }
  });
});

describe('mail, contracts, CRM', () => {
  it('loads every mail view', async () => {
    for (const view of MAIL_VIEWS) await ok(`listMail ${view}`, () => listMail(view, 20));
  });
  it('loads the contracts board and the intake list', async () => {
    await ok('contractBoard', () => contractBoard());
    await ok('listContracts', () => listContracts());
    await ok('listIntake', () => listIntake());
    await ok('contractCounts', () => contractCounts());
    await ok('pendingIntake', () => pendingIntake());
    await ok('suggestLinks', () => suggestLinks('Acme'));
  });
  it('loads the CRM', async () => {
    const companies = (await ok('listCompanies', () => listCompanies({}))) as { rows: { hubspotId: string }[] };
    await ok('listContacts', () => listContacts({}));
    await ok('crmSummary', () => crmSummary());
    await ok('crmFilterOptions', () => crmFilterOptions());
    await ok('companySuggestions', () => companySuggestions());
    await ok('contactsForCompanies', () => contactsForCompanies(companies.rows.slice(0, 3).map((c) => c.hubspotId)));
    await ok('conversationsFor', () => conversationsFor(['nobody@example.com']));
  });

  it('opens one company and one contact, whole', async () => {
    const { rows: companies } = await listCompanies({});
    const { rows: contacts } = await listContacts({});
    await ok('conversationsWith', () => conversationsWith(['nobody@example.com']));

    // An id that is not there answers null rather than throwing: a stale
    // bookmark should reach the not-found page, not a 500.
    expect(await getCompany('no-such-company')).toBeNull();
    expect(await getContact('no-such-contact')).toBeNull();

    const company = companies[0];
    if (company) {
      const detail = (await ok('getCompany', () => getCompany(company.hubspotId))) as {
        company: { hubspotId: string };
        contacts: unknown[];
      } | null;
      expect(detail?.company.hubspotId).toBe(company.hubspotId);
    }
    const contact = contacts[0];
    if (contact) {
      const detail = (await ok('getContact', () => getContact(contact.hubspotId))) as {
        contact: { hubspotId: string };
      } | null;
      expect(detail?.contact.hubspotId).toBe(contact.hubspotId);
    }
  });
});

describe('revenue, seats, trading', () => {
  it('loads every period on every screen that has one', async () => {
    await ok('summariseAllPeriods', () => summariseAllPeriods(PERIODS));
    for (const period of PERIODS) {
      await ok(`summariseForPeriod ${period}`, () => summariseForPeriod(period));
      await ok(`loadSeats demand ${period}`, () => loadSeats('demand', period));
      await ok(`loadSeats supply ${period}`, () => loadSeats('supply', period));
    }
    await ok('availableSeatPeriods', () => availableSeatPeriods());
    for (const period of TRADING_PERIODS) await ok(`loadTrading ${period}`, () => loadTrading(period));
  });
});

describe('delegations and the copilot', () => {
  it('loads every delegation view', async () => {
    for (const view of DELEGATION_VIEWS) await ok(`listDelegations ${view}`, () => listDelegations(view));
    await ok('delegationCounts', () => delegationCounts());
    await ok('delegatableTeam', () => delegatableTeam('maor@adnimation.com'));
  });
  it('loads the keys screen', async () => {
    await ok('statusOf', () => statusOf(SECRET_KEYS));
  });

  it('loads the marketing screen', async () => {
    await ok('listDrafts', () => listDrafts());
    await ok('draftCounts', () => draftCounts());
    await ok('linkedInReady', () => linkedInReady());
    await ok('findWins', () => findWins({ days: 30, limit: 3 }));
    await ok('findWins from mail', () => findWins({ sources: ['mail'], days: 7, limit: 3 }));
  });

  it('loads the copilot screen', async () => {
    await ok('listThreads', () => listThreads());
    await ok('recentDecisions', () => recentDecisions(40));
    await ok('decisionCounts', () => decisionCounts());
    await ok('lastReviewAt', () => lastReviewAt());
    await ok('slackReach', () => slackReach());
  });
});
