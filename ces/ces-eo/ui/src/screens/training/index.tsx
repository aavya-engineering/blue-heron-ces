// SPDX-FileCopyrightText: Blue Heron Defense LLC and its licensors. All rights reserved.
// SPDX-License-Identifier: LicenseRef-BHD-Proprietary
// CONFIDENTIAL - TRADE SECRET. Unpublished work. Provided solely to perform work for Blue Heron Defense LLC at its direction.
// Any other use, copying, disclosure, or reuse, in whole or in part, is prohibited.
// Changes made to this file for Blue Heron Defense LLC are made on its behalf; it claims all rights in them.
// Submitting a change to this repository means you accept TERMS.md.
// Removing or altering this notice is prohibited (17 U.S.C. 1202). Ref: BHD-CES-MONO-2026A
// See LICENSE and TERMS.md.

// Training: the AT.L2-3.2.2 role population (FD-9, the operator-defined list; route from
// LOG-FIN-26b: GET / PUT /api/personnel/:slug/role-population) and each person's course record
// (legacy openTrainingModal / renderTrainingCourseTable / markCourseComplete / removeTrainingCompletion).
// FIN-31b adds training assign, the simulated assignment email (FD-6), certificate upload and
// download, and course catalog editing.

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { eoApi } from '../../api/eo';
import { saveFile } from '../../api/http';
import type { TrainingCourse } from '../../api/types';
import { Card, ConfirmButton, Field, Notice, TenantRequired, copyText, useAction } from '../../components/common';
import { usePersonnel, useTrainingCatalog } from '../../components/personnelQueries';

/** One job title per line; blanks and duplicates dropped (the route cleans the list again). */
export function parseRoles(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const r = line.trim();
    if (r && !out.includes(r)) out.push(r);
  }
  return out;
}

function RolePopulationCard({ tenant }: { tenant: string }) {
  const qc = useQueryClient();
  const pop = useQuery({ queryKey: ['role-population', tenant], queryFn: () => eoApi.rolePopulation(tenant), retry: false });
  const [text, setText] = useState('');
  const save = useAction();
  useEffect(() => {
    if (pop.data) setText((pop.data.population?.roles ?? []).join('\n'));
  }, [pop.data]);
  const source = pop.data?.population?.source;
  return (
    <Card title="Role-based training population (AT.L2-3.2.2)" id="eo-role-population">
      <p>
        The job titles whose holders need role-based security training. An empty list clears the operator list; EO then falls back to the
        interview answer (PI.PER.012), if there is one.
      </p>
      <p className="eo-muted" id="rolePopulationState">
        {pop.data?.population
          ? `In force: ${pop.data.population.roles.length} role(s)${typeof source === 'string' ? ` (source: ${source})` : ''}.`
          : 'No population defined.'}
      </p>
      <Field label="Roles (one per line)">
        <textarea id="rolePopulationRoles" rows={5} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <div className="eo-row">
        <button type="button" className="btn btn-primary btn-small" id="rolePopulationSave" disabled={save.busy}
          onClick={() => void save.run(async () => {
            const r = await eoApi.saveRolePopulation(tenant, parseRoles(text));
            qc.setQueryData(['role-population', tenant], r);
            return r;
          }, (r) => (r.population ? `Saved ${r.population.roles.length} role(s).` : 'Cleared the operator list.'))}>
          Save population
        </button>
      </div>
      {save.message ? <Notice kind={save.message.kind}>{save.message.text}</Notice> : null}
    </Card>
  );
}

/** Legacy course status: Completed / Overdue (expired) / Assigned (required, not done) / Not Started. */
export function courseStatus(completion: { expiryDate?: string } | undefined, required: boolean, today = new Date()): string {
  if (completion) return completion.expiryDate && new Date(completion.expiryDate) < today ? 'Overdue' : 'Completed';
  return required ? 'Assigned' : 'Not Started';
}

/** Legacy markCourseComplete: today, plus an expiry from the course's refresh cycle. */
function completionBody(course: TrainingCourse) {
  const completedDate = new Date().toISOString().slice(0, 10);
  let expiryDate: string | undefined;
  if (course.refresh_cycle_days) {
    const exp = new Date();
    exp.setDate(exp.getDate() + course.refresh_cycle_days);
    expiryDate = exp.toISOString().slice(0, 10);
  }
  return { courseId: course.id, completedDate, ...(expiryDate ? { expiryDate } : {}) };
}

/**
 * FIN-31b: legacy submitAssignTraining (checkbox list, all ticked by default) and
 * generateTrainingEmail. FD-6: "sends" means a simulated outbox in V1, so the email is generated
 * and shown to copy; EO sends nothing and records a "training-email-generated" lifecycle event on
 * the person (the evidence that the assignment notice was produced).
 */
function AssignAndEmail({ tenant, personId, courses, onChanged }: { tenant: string; personId: string; courses: TrainingCourse[]; onChanged: () => Promise<void> }) {
  const [mode, setMode] = useState<'none' | 'assign' | 'email'>('none');
  const [picked, setPicked] = useState<string[]>(() => courses.map((c) => c.id));
  const [emailText, setEmailText] = useState('');
  const act = useAction();
  return (
    <>
      <div className="eo-row">
        <button type="button" className="btn btn-primary btn-small" id="assignTrainingBtn" aria-pressed={mode === 'assign'}
          onClick={() => { setPicked(courses.map((c) => c.id)); setMode(mode === 'assign' ? 'none' : 'assign'); }}>Assign training</button>
        <button type="button" className="btn btn-secondary btn-small" id="trainingEmailBtn" disabled={act.busy || courses.length === 0}
          onClick={() => void act.run(async () => {
            const r = await eoApi.trainingEmail(tenant, personId, courses.map((c) => c.id));
            setEmailText(r.emailText);
            setMode('email');
            await onChanged();
            return r;
          }, () => 'Assignment email generated (simulated: not sent).')}>
          Generate email
        </button>
      </div>
      {mode === 'assign' ? (
        <fieldset className="eo-fieldset" id="assignCourseList">
          <legend>Assign training courses</legend>
          {courses.map((c) => (
            <label key={c.id} className="eo-check">
              <input type="checkbox" checked={picked.includes(c.id)} value={c.id}
                onChange={(e) => setPicked((x) => (e.target.checked ? [...x, c.id] : x.filter((y) => y !== c.id)))} />
              <span>{c.title}</span>
              {c.provider || c.duration ? <span className="eo-muted">{`${c.provider ?? ''}${c.provider && c.duration ? ' - ' : ''}${c.duration ?? ''}`}</span> : null}
            </label>
          ))}
          <div className="eo-row">
            <button type="button" className="btn btn-primary btn-small" id="assignSubmitBtn" disabled={picked.length === 0 || act.busy}
              onClick={() => void act.run(async () => { await eoApi.assignTraining(tenant, personId, picked); setMode('none'); await onChanged(); }, () => `Assigned ${picked.length} course(s).`)}>
              Assign selected
            </button>
          </div>
        </fieldset>
      ) : null}
      {mode === 'email' ? (
        <section className="eo-gdb" id="trainingEmail" aria-label="Training assignment email">
          <Notice kind="info">Simulated outbox (FD-6): EO sends no email. The generation is recorded on the person's lifecycle events; copy the text to deliver it yourself.</Notice>
          <Field label="Training assignment email"><textarea id="trainingEmailText" readOnly rows={10} value={emailText} /></Field>
          <div className="eo-row">
            <button type="button" className="btn btn-primary btn-small" id="trainingEmailCopy"
              onClick={() => void act.run(async () => ((await copyText(emailText)) ? 'Copied to the clipboard.' : 'No clipboard here: select the text and copy it.'), (m) => m)}>
              Copy to clipboard
            </button>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setMode('none')}>Close</button>
          </div>
        </section>
      ) : null}
      {act.message ? <Notice kind={act.message.kind}>{act.message.text}</Notice> : null}
    </>
  );
}

function CertUpload({ tenant, personId, course, onDone }: { tenant: string; personId: string; course: TrainingCourse; onDone: () => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const act = useAction();
  return (
    <span className="eo-row">
      <label className="eo-field">
        <span className="eo-field-label">{`Certificate for ${course.title}`}</span>
        <input type="file" accept=".pdf,.png,.jpg,.jpeg,.docx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <button type="button" className="btn btn-secondary btn-small" aria-label={`Upload certificate for ${course.title}`} disabled={!file || act.busy}
        onClick={() => void act.run(async () => { const a = await eoApi.uploadCertificate(tenant, personId, course.id, file!); setFile(null); await onDone(); return a; }, (a) => `Uploaded ${a.filename}.`)}>
        Upload cert
      </button>
      {act.message ? <Notice kind={act.message.kind}>{act.message.text}</Notice> : null}
    </span>
  );
}

/** One person's course record (legacy training modal), reused by the Personnel ledger. */
export function TrainingPanel({ tenant, personId }: { tenant: string; personId: string }) {
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: ['training', tenant, personId], queryFn: () => eoApi.training(tenant, personId), retry: false });
  const catalog = useTrainingCatalog(tenant);
  const act = useAction();
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['training', tenant, personId] });
    await qc.invalidateQueries({ queryKey: ['training-status', tenant] });
    await qc.invalidateQueries({ queryKey: ['personnel', tenant] });
  };
  const completions = detail.data?.state?.completions ?? [];
  const required = detail.data?.requiredCourses ?? [];
  const courses = catalog.data?.courses ?? [];

  return (
    <>
      <AssignAndEmail key={`${personId}-${courses.length}`} tenant={tenant} personId={personId} courses={courses} onChanged={refresh} />
      {act.message ? <Notice kind={act.message.kind}>{act.message.text}</Notice> : null}
      <div className="eo-table-wrap">
        <table className="eo-table" id="trainingCourseTable">
          <thead><tr><th scope="col">Course</th><th scope="col">Status</th><th scope="col">Completed</th><th scope="col">Expires</th><th scope="col">Certificate</th><th scope="col">Action</th></tr></thead>
          <tbody>
            {courses.length === 0 ? <tr><td colSpan={6}>No courses in catalog</td></tr> : courses.map((course) => {
              const c = completions.find((x) => x.courseId === course.id);
              const status = courseStatus(c, required.includes(course.id));
              return (
                <tr key={course.id}>
                  <td>{course.title}</td>
                  <td>{status}</td>
                  <td>{c ? new Date(c.completedDate).toLocaleDateString() : '—'}</td>
                  <td>{c?.expiryDate ? new Date(c.expiryDate).toLocaleDateString() : '—'}</td>
                  <td>
                    {c?.certificateArtifactId ? (
                      <button type="button" className="eo-linkbtn" aria-label={`Download certificate for ${course.title}`} disabled={act.busy}
                        onClick={() => void act.run(async () => { const f = await eoApi.downloadAttachment(tenant, personId, c.certificateArtifactId!, `certificate-${course.id}`); saveFile(f); return f; }, (f) => `Downloaded ${f.filename}.`)}>
                        Download
                      </button>
                    ) : '—'}
                  </td>
                  <td>
                    <div className="eo-row">
                      {status !== 'Completed' ? (
                        <button type="button" className="btn btn-primary btn-small" aria-label={`Mark ${course.title} complete`} disabled={act.busy}
                          onClick={() => void act.run(async () => { await eoApi.completeCourse(tenant, personId, completionBody(course)); await refresh(); }, () => `${course.title}: completed.`)}>
                          Complete
                        </button>
                      ) : null}
                      {c ? (
                        <ConfirmButton label="Remove" ariaLabel={`Remove ${course.title} completion`} disabled={act.busy}
                          onConfirm={() => void act.run(async () => { await eoApi.removeCompletion(tenant, personId, course.id); await refresh(); }, () => `${course.title}: completion removed.`)} />
                      ) : null}
                    </div>
                    <CertUpload tenant={tenant} personId={personId} course={course} onDone={refresh} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

const splitList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

/**
 * FIN-31b: course catalog editing (legacy loadCatalogTable / submitAddCourse / deleteCatalogCourse):
 * read-modify-write of the whole catalog with PUT /api/training/catalog, as legacy does.
 */
export function CatalogEditor({ tenant }: { tenant: string }) {
  const qc = useQueryClient();
  const catalog = useTrainingCatalog(tenant);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ id: '', title: '', provider: '', duration: '', launchUrl: '', roles: 'all_users', controls: '', refreshDays: '365' });
  const act = useAction();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const courses = catalog.data?.courses ?? [];

  const save = async (mutate: (cs: TrainingCourse[]) => TrainingCourse[]) => {
    const fresh = await eoApi.trainingCatalog(tenant); // legacy re-reads the catalog before writing it
    await eoApi.saveTrainingCatalog(tenant, { ...fresh, courses: mutate(fresh.courses ?? []) });
    await qc.invalidateQueries({ queryKey: ['training-catalog', tenant] });
  };

  return (
    <Card title="Course catalog" id="eo-catalog-card"
      actions={<button type="button" className="btn btn-primary btn-small" id="addCourseBtn" aria-pressed={adding} onClick={() => setAdding((x) => !x)}>Add course</button>}>
      {adding ? (
        <fieldset className="eo-fieldset" id="addCourseForm">
          <legend>Add course</legend>
          <div className="eo-grid-2">
            <Field label="Course ID"><input id="newCourseId" value={f.id} onChange={set('id')} placeholder="custom-training-101" /></Field>
            <Field label="Title"><input id="newCourseTitle" value={f.title} onChange={set('title')} /></Field>
            <Field label="Provider"><input id="newCourseProvider" value={f.provider} onChange={set('provider')} /></Field>
            <Field label="Duration"><input id="newCourseDuration" value={f.duration} onChange={set('duration')} placeholder="60min" /></Field>
            <Field label="Launch URL"><input id="newCourseLaunchUrl" value={f.launchUrl} onChange={set('launchUrl')} /></Field>
            <Field label="Target roles (comma-separated)"><input id="newCourseTargetRoles" value={f.roles} onChange={set('roles')} /></Field>
            <Field label="Satisfies controls (comma-separated)"><input id="newCourseControls" value={f.controls} onChange={set('controls')} placeholder="AT.L2-3.2.1" /></Field>
            <Field label="Refresh cycle (days)"><input id="newCourseRefreshDays" type="number" min={1} value={f.refreshDays} onChange={set('refreshDays')} /></Field>
          </div>
          <div className="eo-row">
            <button type="button" className="btn btn-primary btn-small" id="addCourseSubmit"
              disabled={!f.id.trim() || !f.title.trim() || !f.provider.trim() || !f.duration.trim() || act.busy}
              onClick={() => void act.run(async () => {
                const roles = splitList(f.roles);
                const course: TrainingCourse = {
                  id: f.id.trim(), title: f.title.trim(), provider: f.provider.trim(), duration: f.duration.trim(),
                  targetRoles: roles, required_for_roles: roles, satisfies_controls: splitList(f.controls),
                  refresh_cycle_days: parseInt(f.refreshDays, 10) || 365, ...(f.launchUrl.trim() ? { launch_url: f.launchUrl.trim() } : {}),
                };
                await save((cs) => [...cs, course]);
                setAdding(false);
                setF({ id: '', title: '', provider: '', duration: '', launchUrl: '', roles: 'all_users', controls: '', refreshDays: '365' });
                return course;
              }, (c) => `Added ${c.title}.`)}>
              Save course
            </button>
          </div>
        </fieldset>
      ) : null}
      {act.message ? <Notice kind={act.message.kind}>{act.message.text}</Notice> : null}
      <div className="eo-table-wrap">
        <table className="eo-table" id="catalogTable">
          <thead><tr><th scope="col">Title</th><th scope="col">Provider</th><th scope="col">Duration</th><th scope="col">Target roles</th><th scope="col">Controls</th><th scope="col">Action</th></tr></thead>
          <tbody>
            {courses.length === 0 ? <tr><td colSpan={6}>No courses in catalog</td></tr> : courses.map((c) => (
              <tr key={c.id}>
                <td>{c.title}</td>
                <td>{c.provider ?? '—'}</td>
                <td>{c.duration ?? '—'}</td>
                <td>{(c.required_for_roles ?? c.targetRoles ?? []).join(', ')}</td>
                <td>{(c.satisfies_controls ?? []).join(', ')}</td>
                <td>
                  <ConfirmButton label="Delete" ariaLabel={`Delete course ${c.title}`} disabled={act.busy}
                    onConfirm={() => void act.run(async () => { await save((cs) => cs.filter((x) => x.id !== c.id)); }, () => `Deleted ${c.title}.`)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function TrainingBody({ tenant }: { tenant: string }) {
  const people = usePersonnel(tenant);
  const [personId, setPersonId] = useState('');
  return (
    <>
      <RolePopulationCard tenant={tenant} />
      <Card title="Training record" id="eo-training-record">
        <Field label="Person">
          <select id="trainingPerson" value={personId} onChange={(e) => setPersonId(e.target.value)}>
            <option value="">Select a person...</option>
            {(people.data ?? []).map((p) => <option key={p.id} value={p.id}>{`${p.displayName} (${p.role})`}</option>)}
          </select>
        </Field>
        {personId ? <TrainingPanel tenant={tenant} personId={personId} /> : null}
      </Card>
      <CatalogEditor tenant={tenant} />
    </>
  );
}

export default function TrainingScreen() {
  return <div className="eo-screen"><TenantRequired>{(t) => <TrainingBody tenant={t} />}</TenantRequired></div>;
}
