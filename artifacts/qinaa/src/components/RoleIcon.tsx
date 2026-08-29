import {
  Crosshair,
  Eye,
  FlaskConical,
  Link2,
  Shield,
  Skull,
  Smile,
  Sword,
  Users,
  VolumeX,
  type LucideIcon,
} from "lucide-react";

const ROLE_ICONS: Record<string, LucideIcon> = {
  "الولد": Sword,
  "الإكة": VolumeX,
  "الشايب": Eye,
  "البنت": Shield,
  "المواطن": Users,
  madman: Smile,
  twin: Link2,
  avenger: Skull,
  magician: FlaskConical,
  sniper: Crosshair,
};

export function RoleIcon({
  roleKey,
  color,
  size = 80,
}: {
  roleKey: string;
  color: string;
  size?: number;
}) {
  const Icon = ROLE_ICONS[roleKey] ?? Users;
  const iconSize = Math.round(size * 0.48);

  return (
    <span
      aria-hidden="true"
      className="role-icon"
      style={{
        width: size,
        height: size,
        color,
        borderColor: `${color}55`,
        background: `radial-gradient(circle at 35% 30%, ${color}2E, ${color}0B 58%, transparent 72%)`,
        boxShadow: `0 0 ${Math.round(size * 0.38)}px ${color}30, inset 0 0 ${Math.round(size * 0.22)}px ${color}12`,
      }}>
      <Icon size={iconSize} strokeWidth={1.55} />
    </span>
  );
}
