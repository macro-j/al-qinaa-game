import type { CSSProperties } from "react";
import { ROLE_META, getRoleName } from "../lib/roles";
import { RoleMaskEmblem } from "./RoleMaskEmblem";

export function RoleCardFace({
  roleKey,
  description,
}: {
  roleKey: string;
  description?: string;
}) {
  const meta = ROLE_META[roleKey] ?? ROLE_META["المواطن"];

  return (
    <div
      className="role-card-face"
      style={{
        backgroundImage: "url('/cards/qinaa-card-base-v1.jpg')",
        "--role-accent": meta.color,
      } as CSSProperties}>
      <div className="role-card-face__emblem">
        <RoleMaskEmblem roleKey={roleKey} color={meta.color} />
      </div>
      <div className="role-card-face__name">{getRoleName(roleKey)}</div>
      <div className="role-card-face__description">{description ?? meta.desc}</div>
    </div>
  );
}
