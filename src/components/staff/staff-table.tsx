"use client";

// §47 — who is on the staff, what they may do, and where. The scope is a
// list of points, because that is exactly what US-47 grants.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  dismissStaff,
  inviteStaff,
  updateStaffScope,
} from "@/app/[locale]/me/charger-operator/[id]/staff/actions";

type Employee = {
  id: string;
  username: string;
  roleName: string;
  permissions: string[];
  pointIds: string[];
};

type StaffLabels = {
  invite: string;
  username: string;
  role: string;
  scope: string;
  wholeNetwork: string;
  add: string;
  save: string;
  remove: string;
  empty: string;
  permissions: string;
  roleNames: Record<string, string>;
};

export function StaffTable({
  operatorId,
  employees,
  roles,
  points,
  labels,
}: {
  operatorId: string;
  employees: Employee[];
  roles: { name: string; permissions: string[] }[];
  points: { id: string; name: string }[];
  labels: StaffLabels;
}) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [roleName, setRoleName] = useState(roles[0]?.name ?? "ENGINEER");
  const [scope, setScope] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  return (
    <div className="space-y-10">
      <section data-testid="staff-invite">
        <h2 className="mb-3 text-[13px] uppercase tracking-[0.14em] text-muted">
          {labels.invite}
        </h2>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block text-sm">
            <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
              {labels.username}
            </span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              aria-label={labels.username}
              className="w-[220px] rounded border border-hairline bg-bg px-3 py-1.5 text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-[11px] uppercase tracking-[0.14em] text-muted">
              {labels.role}
            </span>
            <select
              value={roleName}
              onChange={(e) => setRoleName(e.target.value)}
              aria-label={labels.role}
              className="rounded border border-hairline bg-bg px-3 py-1.5 text-sm"
            >
              {roles.map((r) => (
                <option key={r.name} value={r.name}>
                  {labels.roleNames[r.name] ?? r.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={pending || username.trim().length < 2}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const r = await inviteStaff({
                  operatorId,
                  username: username.trim(),
                  roleName,
                  pointIds: scope,
                });
                if (!r.ok) setError(r.formError);
                else {
                  setUsername("");
                  setScope([]);
                  router.refresh();
                }
              });
            }}
            className="rounded border border-hairline px-3 py-1.5 text-[13px] hover:border-accent disabled:opacity-50"
          >
            {labels.add}
          </button>
        </div>

        <fieldset className="mt-3">
          <legend className="mb-1 text-[11px] uppercase tracking-[0.14em] text-muted">
            {labels.scope}
          </legend>
          <p className="mb-1 text-[12px] text-muted">{labels.wholeNetwork}</p>
          <div className="flex flex-wrap gap-3">
            {points.map((p) => (
              <label key={p.id} className="flex items-center gap-1 text-[13px]">
                <input
                  type="checkbox"
                  checked={scope.includes(p.id)}
                  onChange={() => setScope(toggle(scope, p.id))}
                />
                {p.name}
              </label>
            ))}
          </div>
        </fieldset>

        {error && <p className="mt-2 text-[13px] text-down">{error}</p>}
      </section>

      <section>
        {employees.length === 0 ? (
          <p className="text-sm text-muted">{labels.empty}</p>
        ) : (
          <ul className="divide-y divide-hairline" data-testid="staff-list">
            {employees.map((e) => (
              <StaffRow
                key={e.id}
                employee={e}
                roles={roles}
                points={points}
                labels={labels}
                onChanged={() => router.refresh()}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StaffRow({
  employee,
  roles,
  points,
  labels,
  onChanged,
}: {
  employee: Employee;
  roles: { name: string; permissions: string[] }[];
  points: { id: string; name: string }[];
  labels: StaffLabels;
  onChanged: () => void;
}) {
  const [roleName, setRoleName] = useState(employee.roleName);
  const [scope, setScope] = useState<string[]>(employee.pointIds);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <li className="py-4" data-testid={`staff-${employee.username}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium">@{employee.username}</span>
        <select
          value={roleName}
          onChange={(e) => setRoleName(e.target.value)}
          aria-label={`${labels.role} ${employee.username}`}
          className="rounded border border-hairline bg-bg px-2 py-1 text-[13px]"
        >
          {roles.map((r) => (
            <option key={r.name} value={r.name}>
              {labels.roleNames[r.name] ?? r.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const r = await updateStaffScope({
                employeeId: employee.id,
                roleName,
                pointIds: scope,
              });
              if (!r.ok) setError(r.formError);
              else onChanged();
            });
          }}
          className="rounded border border-hairline px-3 py-1 text-[13px] hover:border-accent disabled:opacity-50"
        >
          {labels.save}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const r = await dismissStaff(employee.id);
              if (!r.ok) setError(r.formError);
              else onChanged();
            });
          }}
          className="rounded border border-down px-3 py-1 text-[13px] text-down disabled:opacity-50"
        >
          {labels.remove}
        </button>
      </div>

      <div className="mt-2 flex flex-wrap gap-3">
        {points.map((p) => (
          <label key={p.id} className="flex items-center gap-1 text-[12px] text-muted">
            <input
              type="checkbox"
              checked={scope.includes(p.id)}
              onChange={() =>
                setScope(
                  scope.includes(p.id) ? scope.filter((x) => x !== p.id) : [...scope, p.id],
                )
              }
            />
            {p.name}
          </label>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-muted">
        {labels.permissions}: {employee.permissions.join(", ")}
      </p>
      {error && <p className="mt-1 text-[12px] text-down">{error}</p>}
    </li>
  );
}
