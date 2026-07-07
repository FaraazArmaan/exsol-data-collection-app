import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { workforceApi, type AiPlan, type Project, type ProjectAssignment, type ProjectBudget, type ProjectDoc, type ProjectRisk, type ProjectStatus, type ProjectTask, type StaffResource } from '../../shared/api';
import '../../workforce.css';

const FSM_NEXT: Record<ProjectStatus, ProjectStatus | null> = {
  quoted: 'active',
  active: 'done',
  done: null,
};

const FSM_LABEL: Record<ProjectStatus, string> = {
  quoted: 'Mark Active',
  active: 'Mark Done',
  done: 'Done',
};

function StatusBadge({ status }: { status: string }) {
  return <span className={`wf-status-badge ${status}`}>{status}</span>;
}

function fmt(cents: number | null): string {
  if (cents === null) return '—';
  return `$${(cents / 100).toFixed(2)}`;
}

function BurnBar({ pct }: { pct: number | null }) {
  if (pct === null) return <p className="wf-empty">No budget set.</p>;
  const cls = pct >= 100 ? 'red' : pct >= 80 ? 'orange' : 'green';
  const width = Math.min(pct, 100);
  return (
    <div>
      <div className="wf-burn-bar-wrap">
        <div className={`wf-burn-bar ${cls}`} style={{ width: `${width}%` }} />
      </div>
      <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{pct}% burned</span>
    </div>
  );
}

interface Props {
  slug: string;
  projectId: string;
  perms: ReadonlySet<string>;
}

export default function ProjectDetailPage({ slug, projectId, perms }: Props) {
  const canEdit = perms.has('project-service.business.edit');
  const navigate = useNavigate();

  const [tab, setTab] = useState<'overview' | 'budget' | 'docs' | 'tasks' | 'planner'>('overview');

  const [project, setProject] = useState<Project | null>(null);
  const [assignments, setAssignments] = useState<ProjectAssignment[]>([]);
  const [resources, setResources] = useState<StaffResource[]>([]);
  const [selectedResource, setSelectedResource] = useState('');
  const [advancing, setAdvancing] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState('');

  const [budget, setBudget] = useState<ProjectBudget | null>(null);
  const [budgetInput, setBudgetInput] = useState('');
  const [rateInput, setRateInput] = useState('');
  const [savingBudget, setSavingBudget] = useState(false);
  const [budgetError, setBudgetError] = useState('');

  const [docs, setDocs] = useState<ProjectDoc[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsError, setDocsError] = useState('');

  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [risk, setRisk] = useState<ProjectRisk | null>(null);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState('');
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDue, setNewTaskDue] = useState('');
  const [creatingTask, setCreatingTask] = useState(false);

  const [planDescription, setPlanDescription] = useState('');
  const [aiPlans, setAiPlans] = useState<AiPlan[]>([]);
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [plannerError, setPlannerError] = useState('');
  const [applyingPlan, setApplyingPlan] = useState<string | null>(null);

  function load() {
    workforceApi.getProject(projectId)
      .then(({ project: p, assignments: a }) => {
        setProject(p);
        setAssignments(a);
      })
      .catch(() => setError('Failed to load project.'));
    workforceApi.listStaff()
      .then((r) => setResources(r.resources.filter((x) => x.active)))
      .catch(() => {});
  }

  function loadBudget() {
    workforceApi.getProjectBudget(projectId)
      .then(({ budget: b }) => {
        setBudget(b);
        setBudgetInput(b.budget_cents !== null ? String(b.budget_cents / 100) : '');
        setRateInput(b.hourly_rate_cents !== null ? String(b.hourly_rate_cents / 100) : '');
      })
      .catch(() => setBudgetError('Failed to load budget.'));
  }

  useEffect(load, [projectId]);
  useEffect(loadBudget, [projectId]);

  useEffect(() => {
    if (tab !== 'docs') return;
    setDocsLoading(true);
    setDocsError('');
    workforceApi.listProjectDocs(projectId)
      .then(({ docs: d }) => setDocs(d))
      .catch(() => setDocsError('Failed to load documents.'))
      .finally(() => setDocsLoading(false));
  }, [tab, projectId]);

  useEffect(() => {
    if (tab !== 'tasks') return;
    setTasksLoading(true);
    setTasksError('');
    Promise.all([
      workforceApi.listProjectTasks(projectId),
      workforceApi.getProjectRisk(projectId),
    ])
      .then(([{ tasks: t }, { risk: r }]) => { setTasks(t); setRisk(r); })
      .catch(() => setTasksError('Failed to load tasks.'))
      .finally(() => setTasksLoading(false));
  }, [tab, projectId]);

  useEffect(() => {
    if (tab !== 'planner') return;
    workforceApi.listAiPlans(projectId)
      .then(({ plans }) => setAiPlans(plans))
      .catch(() => {});
  }, [tab, projectId]);

  async function advance() {
    if (!project) return;
    const next = FSM_NEXT[project.status];
    if (!next) return;
    setAdvancing(true);
    setError('');
    try {
      await workforceApi.advanceStatus(project.id, next);
      load();
    } catch {
      setError('Could not advance status.');
    } finally {
      setAdvancing(false);
    }
  }

  async function assign(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedResource || !project) return;
    setAssigning(true);
    setError('');
    try {
      await workforceApi.assignResource(project.id, selectedResource);
      setSelectedResource('');
      load();
    } catch {
      setError('Could not assign resource.');
    } finally {
      setAssigning(false);
    }
  }

  async function unassign(resourceId: string) {
    if (!project) return;
    setError('');
    try {
      await workforceApi.unassignResource(project.id, resourceId);
      load();
    } catch {
      setError('Could not unassign resource.');
    }
  }

  async function saveBudget(e: React.FormEvent) {
    e.preventDefault();
    setSavingBudget(true);
    setBudgetError('');
    try {
      const budgetCents = budgetInput ? Math.round(parseFloat(budgetInput) * 100) : null;
      const rateCents = rateInput ? Math.round(parseFloat(rateInput) * 100) : null;
      await workforceApi.setProjectBudget(projectId, {
        budget_cents: budgetCents,
        hourly_rate_cents: rateCents,
      });
      loadBudget();
    } catch {
      setBudgetError('Could not save budget.');
    } finally {
      setSavingBudget(false);
    }
  }

  if (!project && !error) return <div className="wf-page"><p>Loading…</p></div>;
  if (error && !project) return <div className="wf-page"><p className="wf-error">{error}</p></div>;

  const nextStatus = FSM_NEXT[project!.status];
  const assignedIds = new Set(assignments.map((a) => a.resource_id));
  const availableResources = resources.filter((r) => !assignedIds.has(r.id));

  return (
    <div className="wf-page">
      <Link to={`/c/${slug}/workforce/projects`} className="wf-back-link">← Projects</Link>

      <div className="wf-detail-header">
        <h2>{project!.name}</h2>
        <StatusBadge status={project!.status} />
        {canEdit && nextStatus && (
          <button className="wf-advance-btn" onClick={advance} disabled={advancing}>
            {advancing ? '…' : FSM_LABEL[project!.status]}
          </button>
        )}
      </div>

      {project!.customer_name && (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', margin: '0 0 16px' }}>
          Customer: {project!.customer_name}
        </p>
      )}

      {error && <p className="wf-error">{error}</p>}

      <div className="wf-proj-tabs">
        <button
          className={`wf-proj-tab${tab === 'overview' ? ' wf-proj-tab-active' : ''}`}
          onClick={() => setTab('overview')}
        >
          Overview
        </button>
        <button
          className={`wf-proj-tab${tab === 'budget' ? ' wf-proj-tab-active' : ''}`}
          onClick={() => setTab('budget')}
        >
          Budget
        </button>
        <button
          className={`wf-proj-tab${tab === 'docs' ? ' wf-proj-tab-active' : ''}`}
          onClick={() => setTab('docs')}
        >
          Documents
        </button>
        <button
          className={`wf-proj-tab${tab === 'tasks' ? ' wf-proj-tab-active' : ''}`}
          onClick={() => setTab('tasks')}
        >
          Tasks &amp; Risk
        </button>
        <button
          className={`wf-proj-tab${tab === 'planner' ? ' wf-proj-tab-active' : ''}`}
          onClick={() => setTab('planner')}
        >
          AI Planner
        </button>
      </div>

      {tab === 'overview' && (
        <div className="wf-section">
          <h3>Assigned Resources</h3>

          {canEdit && availableResources.length > 0 && project!.status !== 'done' && (
            <form className="wf-create-form" onSubmit={assign} style={{ marginBottom: 12 }}>
              <select
                value={selectedResource}
                onChange={(e) => setSelectedResource(e.target.value)}
                required
              >
                <option value="">Select a resource…</option>
                {availableResources.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
              <button type="submit" disabled={assigning || !selectedResource}>
                {assigning ? 'Assigning…' : 'Assign'}
              </button>
            </form>
          )}

          {assignments.length === 0 && (
            <p className="wf-empty">No resources assigned yet.</p>
          )}

          <div className="wf-assignment-list">
            {assignments.map((a) => (
              <div key={a.resource_id} className="wf-assignment-row">
                <span>{a.resource_name}</span>
                {canEdit && project!.status !== 'done' && (
                  <button onClick={() => unassign(a.resource_id)}>Remove</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'docs' && (
        <div className="wf-section">
          <h3>Project Documents</h3>
          <p className="wf-proj-doc-hint">
            Link existing files from your File Manager to this project. Upload files in the File Manager first, then link them here.
          </p>
          {docsError && <p className="wf-error">{docsError}</p>}
          {docsLoading && <p>Loading…</p>}
          {!docsLoading && docs.length === 0 && <p className="wf-empty">No documents linked yet.</p>}
          <div className="wf-doc-list">
            {docs.map((d) => (
              <div key={d.file_id} className="wf-doc-row">
                <span className="wf-doc-type-badge">{d.type}</span>
                <span className="wf-doc-title">{d.title}</span>
                {d.filename && <span className="wf-doc-meta">{d.filename}</span>}
                {canEdit && (
                  <button
                    className="wf-doc-unlink"
                    onClick={() => {
                      workforceApi.unlinkProjectDoc(projectId, d.file_id)
                        .then(() => setDocs((prev) => prev.filter((x) => x.file_id !== d.file_id)))
                        .catch(() => setDocsError('Could not unlink document.'));
                    }}
                  >
                    Unlink
                  </button>
                )}
              </div>
            ))}
          </div>
          {canEdit && (
            <form
              className="wf-doc-link-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                const fileId = (fd.get('file_id') as string).trim();
                if (!fileId) return;
                try {
                  await workforceApi.linkProjectDoc(projectId, fileId);
                  (e.target as HTMLFormElement).reset();
                  setDocsLoading(true);
                  workforceApi.listProjectDocs(projectId)
                    .then(({ docs: d }) => setDocs(d))
                    .finally(() => setDocsLoading(false));
                } catch {
                  setDocsError('Could not link document. Check the File ID.');
                }
              }}
            >
              <input name="file_id" placeholder="Paste File ID to link…" required />
              <button type="submit">Link</button>
            </form>
          )}
        </div>
      )}

      {tab === 'tasks' && (
        <div className="wf-section">
          <h3>Tasks &amp; Risk</h3>
          {tasksError && <p className="wf-error">{tasksError}</p>}
          {tasksLoading && <p>Loading…</p>}
          {!tasksLoading && risk && (
            <div className="wf-risk-banner">
              <div>
                <div className={`wf-risk-score ${risk.health_score >= 80 ? 'green' : risk.health_score >= 50 ? 'orange' : 'red'}`}>
                  {risk.health_score}
                </div>
                <div className="wf-risk-label">Health Score</div>
              </div>
              {risk.flags.length > 0 && (
                <div className="wf-risk-flags">
                  {risk.flags.map((f) => (
                    <span key={f} className="wf-risk-flag">{f}</span>
                  ))}
                </div>
              )}
            </div>
          )}
          {canEdit && (
            <form
              className="wf-task-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newTaskTitle.trim()) return;
                setCreatingTask(true);
                try {
                  await workforceApi.createProjectTask({
                    project_id: projectId,
                    title: newTaskTitle.trim(),
                    due_date: newTaskDue || null,
                  });
                  setNewTaskTitle('');
                  setNewTaskDue('');
                  const [{ tasks: t }, { risk: r }] = await Promise.all([
                    workforceApi.listProjectTasks(projectId),
                    workforceApi.getProjectRisk(projectId),
                  ]);
                  setTasks(t);
                  setRisk(r);
                } catch {
                  setTasksError('Could not create task.');
                } finally {
                  setCreatingTask(false);
                }
              }}
            >
              <input
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                placeholder="New task title…"
                required
              />
              <input
                type="date"
                value={newTaskDue}
                onChange={(e) => setNewTaskDue(e.target.value)}
              />
              <button type="submit" disabled={creatingTask || !newTaskTitle.trim()}>
                {creatingTask ? 'Adding…' : 'Add Task'}
              </button>
            </form>
          )}
          {!tasksLoading && tasks.length === 0 && <p className="wf-empty">No tasks yet.</p>}
          <div className="wf-task-list">
            {tasks.map((t) => {
              const isOverdue = t.due_date !== null && t.due_date < new Date().toISOString().slice(0, 10) && t.status !== 'done';
              const nextStatus: Record<string, 'in_progress' | 'done' | null> = { open: 'in_progress', in_progress: 'done', done: null };
              return (
                <div key={t.id} className="wf-task-row">
                  <span className="wf-task-title">{t.title}</span>
                  {t.assigned_name && (
                    <span className="wf-task-due">{t.assigned_name}</span>
                  )}
                  {t.due_date && (
                    <span className={`wf-task-due${isOverdue ? ' overdue' : ''}`}>{t.due_date}</span>
                  )}
                  <button
                    className={`wf-task-status${t.status === 'done' ? ' done' : ''}`}
                    onClick={async () => {
                      const next = nextStatus[t.status];
                      if (!next || !canEdit) return;
                      try {
                        await workforceApi.updateProjectTask(t.id, { status: next });
                        const [{ tasks: ts }, { risk: r }] = await Promise.all([
                          workforceApi.listProjectTasks(projectId),
                          workforceApi.getProjectRisk(projectId),
                        ]);
                        setTasks(ts);
                        setRisk(r);
                      } catch {
                        setTasksError('Could not update task.');
                      }
                    }}
                    disabled={!canEdit || t.status === 'done'}
                  >
                    {t.status}
                  </button>
                  {canEdit && (
                    <button
                      className="wf-task-delete"
                      onClick={async () => {
                        try {
                          await workforceApi.deleteProjectTask(t.id);
                          const [{ tasks: ts }, { risk: r }] = await Promise.all([
                            workforceApi.listProjectTasks(projectId),
                            workforceApi.getProjectRisk(projectId),
                          ]);
                          setTasks(ts);
                          setRisk(r);
                        } catch {
                          setTasksError('Could not delete task.');
                        }
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'planner' && (
        <div className="wf-section">
          <h3>AI Project Planner</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 0.75rem' }}>
            Describe what this project needs to accomplish. The AI will generate a draft task plan for your review.
          </p>
          {plannerError && <p className="wf-error">{plannerError}</p>}
          <form
            className="wf-planner-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!planDescription.trim()) return;
              setGeneratingPlan(true);
              setPlannerError('');
              try {
                const { plan } = await workforceApi.generateAiPlan(projectId, planDescription.trim());
                setAiPlans((prev) => [plan, ...prev]);
                setPlanDescription('');
              } catch {
                setPlannerError('Could not generate plan. Try again.');
              } finally {
                setGeneratingPlan(false);
              }
            }}
          >
            <textarea
              value={planDescription}
              onChange={(e) => setPlanDescription(e.target.value)}
              placeholder="e.g. Build a customer portal with login, dashboard, and billing pages…"
              maxLength={2000}
              required
            />
            <button type="submit" disabled={generatingPlan || !planDescription.trim()}>
              {generatingPlan ? 'Generating…' : 'Generate Plan'}
            </button>
          </form>

          {aiPlans.map((plan) => (
            <div key={plan.id} className="wf-plan-card">
              <div className="wf-plan-header">
                <span className="wf-plan-prompt">{plan.prompt_text}</span>
                {plan.fallback && <span className="wf-plan-fallback">AI fallback</span>}
              </div>
              <ol className="wf-plan-tasks">
                {plan.draft_tasks.map((t, i) => (
                  <li key={i} className="wf-plan-task">
                    <strong>{t.title}</strong>
                    {t.due_date && <span className="wf-plan-due"> · due {t.due_date}</span>}
                    {t.description && <p className="wf-plan-desc">{t.description}</p>}
                  </li>
                ))}
              </ol>
              <button
                className="wf-plan-apply-btn"
                disabled={applyingPlan === plan.id}
                onClick={async () => {
                  setApplyingPlan(plan.id);
                  setPlannerError('');
                  try {
                    const { applied } = await workforceApi.applyAiPlan(plan.id);
                    alert(`${applied} task${applied !== 1 ? 's' : ''} added to project. Switch to Tasks & Risk to view them.`);
                  } catch {
                    setPlannerError('Could not apply plan.');
                  } finally {
                    setApplyingPlan(null);
                  }
                }}
              >
                {applyingPlan === plan.id ? 'Applying…' : `Apply All ${plan.draft_tasks.length} Tasks`}
              </button>
            </div>
          ))}
          {aiPlans.length === 0 && !generatingPlan && (
            <p className="wf-empty">No plans generated yet. Describe the project above to get started.</p>
          )}
        </div>
      )}

      {tab === 'budget' && (
        <div className="wf-section">
          <h3>Budget</h3>
          {budgetError && <p className="wf-error">{budgetError}</p>}
          {budget && (
            <>
              <div className="wf-budget-grid">
                <div className="wf-budget-card">
                  <div className="wf-budget-label">Budget</div>
                  <div className="wf-budget-value">{fmt(budget.budget_cents)}</div>
                </div>
                <div className="wf-budget-card">
                  <div className="wf-budget-label">Total Spent</div>
                  <div className="wf-budget-value">{fmt(budget.total_spent_cents)}</div>
                </div>
                <div className="wf-budget-card">
                  <div className="wf-budget-label">Timesheet Cost</div>
                  <div className="wf-budget-value">{fmt(budget.timesheet_cost_cents)}</div>
                </div>
                <div className="wf-budget-card">
                  <div className="wf-budget-label">Expenses</div>
                  <div className="wf-budget-value">{fmt(budget.expense_cents)}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{budget.expense_count} item{budget.expense_count !== 1 ? 's' : ''}</div>
                </div>
                <div className="wf-budget-card">
                  <div className="wf-budget-label">Hours Logged</div>
                  <div className="wf-budget-value">{budget.total_hours.toFixed(1)}h</div>
                </div>
                <div className="wf-budget-card">
                  <div className="wf-budget-label">Hourly Rate</div>
                  <div className="wf-budget-value">{fmt(budget.hourly_rate_cents)}</div>
                </div>
              </div>
              <BurnBar pct={budget.burn_pct} />

              {canEdit && project!.status !== 'done' && (
                <form className="wf-budget-form" onSubmit={saveBudget}>
                  <label>
                    Budget ($)
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={budgetInput}
                      onChange={(e) => setBudgetInput(e.target.value)}
                      placeholder="e.g. 5000.00"
                    />
                  </label>
                  <label>
                    Hourly Rate ($/h)
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={rateInput}
                      onChange={(e) => setRateInput(e.target.value)}
                      placeholder="e.g. 50.00"
                    />
                  </label>
                  <button type="submit" disabled={savingBudget}>
                    {savingBudget ? 'Saving…' : 'Save Budget'}
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
