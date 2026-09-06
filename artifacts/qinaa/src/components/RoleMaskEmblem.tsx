import { RoleIcon } from "./RoleIcon";

type RoleMaskEmblemProps = {
  roleKey: string;
  color: string;
};

const MASK_SHAPE = "M24 38 Q57 20 98 34 L120 49 L142 34 Q183 20 216 38 L211 106 Q170 134 120 148 Q70 134 29 106 Z";

function KillerMask({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 240 170" className="role-mask-svg" aria-hidden="true">
      <path d={MASK_SHAPE} fill="#202020" stroke="#070707" strokeWidth="12" strokeLinejoin="round" />
      <path d={MASK_SHAPE} fill="none" stroke={color} strokeWidth="4" strokeLinejoin="round" />
      <path d="M50 68 Q76 50 100 65 Q82 83 58 82 Z" fill={color} opacity="0.9" />
      <path d="M190 68 Q164 50 140 65 Q158 83 182 82 Z" fill={color} opacity="0.9" />
      <path d="M68 137 L173 25 L184 19 L78 143 Z" fill={color} />
      <path d="M75 137 L177 27" stroke="#FF8A8A" strokeWidth="2" opacity="0.55" />
    </svg>
  );
}

function SilencerMask({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 240 170" className="role-mask-svg" aria-hidden="true">
      <path d={MASK_SHAPE} fill="#202020" stroke="#070707" strokeWidth="12" strokeLinejoin="round" />
      <path d={MASK_SHAPE} fill="none" stroke={color} strokeWidth="4" strokeLinejoin="round" />
      <path d="M50 68 Q76 56 100 68 Q81 78 57 78 Z" fill={color} opacity="0.82" />
      <path d="M190 68 Q164 56 140 68 Q159 78 183 78 Z" fill={color} opacity="0.82" />
      <rect x="48" y="96" width="144" height="24" rx="12" fill="#090909" stroke={color} strokeWidth="3" />
      <path d="M76 99 V117 M98 99 V117 M120 98 V118 M142 99 V117 M164 99 V117" stroke={color} strokeWidth="4" strokeLinecap="round" />
      <path d="M112 108 L120 100 L128 108 L120 116 Z" fill={color} />
    </svg>
  );
}

export function RoleMaskEmblem({ roleKey, color }: RoleMaskEmblemProps) {
  if (roleKey === "الولد") return <KillerMask color={color} />;
  if (roleKey === "الإكة") return <SilencerMask color={color} />;

  return (
    <div className="role-mask-fallback" aria-hidden="true">
      <RoleIcon roleKey={roleKey} color={color} size={104} />
    </div>
  );
}
