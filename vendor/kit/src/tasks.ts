import { z } from "zod";

export const Id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

const BoardTaskRef = z.object({
  tracker: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
  host: z.string().max(255).optional(),
  scope: z.string().max(200),
  key: z.string().max(100),
  url: z.url(),
});

const Timestamp = z.iso.datetime();

const BoardTask = z.object({
  id: Id,
  title: z.string().max(300),
  ref: BoardTaskRef,
  openedAt: Timestamp,
  closedAt: Timestamp.nullable(),
});

export const OpenToken = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/);

const BoardCardKind = OpenToken;

const Login = z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/);

const PersonRef = z.object({
  id: Id,
  login: Login,
});

const BoardLease = z.object({
  holder: PersonRef,
  state: OpenToken,
  since: Timestamp,
  lastSignalAt: Timestamp,
  staleAt: Timestamp,
  expiresAt: Timestamp,
});

const LeaseReason = OpenToken;

const LeaseLastRelease = z.object({
  by: PersonRef,
  at: Timestamp,
  reason: LeaseReason,
  freeToContinue: z.boolean(),
  reasonText: z.string().min(1).max(200).optional(),
  note: z.string().min(1).max(2048).optional(),
});

const BoardAssignees = z.array(PersonRef).max(10);

const PrApprovals = z.object({
  required: z.int().min(0),
  have: z.int().min(0),
  stale: z.boolean(),
  lastPushApproval: z.boolean(),
  lastPushSatisfied: z.boolean(),
  codeOwners: z.object({
    required: z.boolean(),
    owners: z.array(z.string().min(1)),
    satisfiedBy: z.array(PersonRef).min(1).optional(),
  }),
});

const BoardChecks = z.object({
  state: OpenToken,
});

const BoardPr = z.object({
  number: z.int().min(1),
  url: z.url(),
  state: OpenToken,
  baseBranch: z.string().min(1).max(255),
  approvals: PrApprovals.nullable(),
  canApprove: z.array(PersonRef),
  youCanApprove: z.boolean(),
  checks: BoardChecks.optional(),
});

const BoardPrs = z.array(BoardPr).max(20);

export const BoardCard = z.object({
  task: BoardTask,
  kind: BoardCardKind,
  column: OpenToken,
  status: OpenToken,
  statusWhy: z.string().min(1).max(240),
  lease: BoardLease.optional(),
  lastRelease: LeaseLastRelease.optional(),
  assignees: BoardAssignees,
  prs: BoardPrs,
  restsOn: z.array(Id).max(100),
});

const TaskPreview = z.object({
  state: OpenToken,
  url: z.url().optional(),
});

const TaskChecked = z.object({
  by: PersonRef,
  at: Timestamp,
  valid: z.boolean(),
  ignoredReason: z.string().min(1).max(240).optional(),
});

export const TaskRead = BoardCard.extend({
  preview: TaskPreview.optional(),
  checked: TaskChecked.optional(),
});
