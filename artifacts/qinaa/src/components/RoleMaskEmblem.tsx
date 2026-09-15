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

function RevealerMask({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 240 170" className="role-mask-svg" aria-hidden="true">
      <path d={MASK_SHAPE} fill="#202020" stroke="#070707" strokeWidth="12" strokeLinejoin="round" />
      <path d={MASK_SHAPE} fill="none" stroke={color} strokeWidth="4" strokeLinejoin="round" />
      <path d="M62 82 Q120 38 178 82 Q120 126 62 82 Z" fill="#090909" stroke={color} strokeWidth="4" />
      <circle cx="120" cy="82" r="24" fill="#242424" stroke={color} strokeWidth="4" />
      <circle cx="120" cy="82" r="12" fill={color} />
      <circle cx="114" cy="76" r="4" fill="#FFE0A3" opacity="0.9" />
      <path d="M120 41 V29 M78 52 L69 42 M162 52 L171 42 M64 82 H50 M176 82 H190" stroke={color} strokeWidth="4" strokeLinecap="round" />
      <path d="M91 128 Q120 142 149 128" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

function ProtectorMask({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 240 170" className="role-mask-svg" aria-hidden="true">
      <path d={MASK_SHAPE} fill="#202020" stroke="#070707" strokeWidth="12" strokeLinejoin="round" />
      <path d={MASK_SHAPE} fill="none" stroke={color} strokeWidth="4" strokeLinejoin="round" />
      <path d="M42 49 Q73 32 99 43 L120 57 L141 43 Q167 32 198 49 L194 98 Q158 121 120 133 Q82 121 46 98 Z" fill="none" stroke={color} strokeWidth="3" opacity="0.55" />
      <path d="M50 68 Q76 51 100 66 Q82 84 58 82 Z" fill={color} opacity="0.88" />
      <path d="M190 68 Q164 51 140 66 Q158 84 182 82 Z" fill={color} opacity="0.88" />
      <path d="M120 86 L146 96 V116 Q146 137 120 150 Q94 137 94 116 V96 Z" fill="#0A0A0A" stroke={color} strokeWidth="4" strokeLinejoin="round" />
      <path d="M120 95 V140 M103 108 Q120 118 137 108" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" opacity="0.8" />
    </svg>
  );
}

function CitizenMask({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 240 170" className="role-mask-svg" aria-hidden="true">
      <path d={MASK_SHAPE} fill="#202020" stroke="#070707" strokeWidth="12" strokeLinejoin="round" />
      <path d={MASK_SHAPE} fill="none" stroke={color} strokeWidth="4" strokeLinejoin="round" />
      <path d="M50 69 Q76 53 100 67 Q82 84 58 82 Z" fill={color} opacity="0.82" />
      <path d="M190 69 Q164 53 140 67 Q158 84 182 82 Z" fill={color} opacity="0.82" />
      <path d="M82 119 H158 M94 119 V137 M120 119 V142 M146 119 V137" fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" />
      <path d="M78 119 L94 106 L108 116 L120 102 L133 116 L146 106 L162 119" fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" />
    </svg>
  );
}

function MadmanMask({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 240 170" className="role-mask-svg" aria-hidden="true">
      <path d={MASK_SHAPE} fill="#202020" stroke="#070707" strokeWidth="12" strokeLinejoin="round" />
      <path d={MASK_SHAPE} fill="none" stroke={color} strokeWidth="4" strokeLinejoin="round" />
      <path d="M50 69 Q76 50 101 68 Q80 88 57 81 Z" fill={color} opacity="0.88" />
      <path d="M145 72 C148 55 177 53 186 69 C193 82 177 92 164 85 C154 80 157 68 168 67 C176 66 180 75 174 80" fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" />
      <path d="M122 40 L108 66 L126 77 L109 101 L130 114 L113 143" fill="none" stroke={color} strokeWidth="4" strokeLinejoin="round" />
      <path d="M74 121 Q98 139 119 126 Q143 111 168 132" fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

function TwinMask({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 240 170" className="role-mask-svg" aria-hidden="true">
      <path d={MASK_SHAPE} fill="#202020" stroke="#070707" strokeWidth="12" strokeLinejoin="round" />
      <path d={MASK_SHAPE} fill="none" stroke={color} strokeWidth="4" strokeLinejoin="round" />
      <path d="M50 68 Q76 51 100 66 Q82 84 58 82 Z" fill={color} opacity="0.88" />
      <path d="M190 68 Q164 51 140 66 Q158 84 182 82 Z" fill={color} opacity="0.88" />
      <path d="M120 49 V144" stroke={color} strokeWidth="3" strokeDasharray="7 6" opacity="0.65" />
      <circle cx="103" cy="112" r="20" fill="#111" stroke={color} strokeWidth="4" />
      <circle cx="137" cy="112" r="20" fill="#111" stroke={color} strokeWidth="4" />
      <path d="M113 112 H127" stroke={color} strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}

function AvengerMask({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 240 170" className="role-mask-svg" aria-hidden="true">
      <path d={MASK_SHAPE} fill="#202020" stroke="#070707" strokeWidth="12" strokeLinejoin="round" />
      <path d={MASK_SHAPE} fill="none" stroke={color} strokeWidth="4" strokeLinejoin="round" />
      <path d="M50 68 Q76 50 100 65 Q82 84 58 82 Z" fill={color} opacity="0.9" />
      <path d="M190 68 Q164 50 140 65 Q158 84 182 82 Z" fill={color} opacity="0.9" />
      <path d="M81 125 Q96 105 120 108 Q145 110 158 94" fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" />
      <path d="M148 91 L163 91 L160 106" fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M159 128 Q144 145 120 139 Q95 134 82 148" fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" />
      <path d="M92 151 L77 151 L80 136" fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MagicianMask({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 240 170" className="role-mask-svg" aria-hidden="true">
      <path d={MASK_SHAPE} fill="#202020" stroke="#070707" strokeWidth="12" strokeLinejoin="round" />
      <path d={MASK_SHAPE} fill="none" stroke={color} strokeWidth="4" strokeLinejoin="round" />
      <path d="M50 68 Q76 51 100 66 Q82 83 58 82 Z" fill={color} opacity="0.88" />
      <path d="M190 68 Q164 51 140 66 Q158 83 182 82 Z" fill={color} opacity="0.88" />
      <path d="M107 89 H133 M112 89 V105 L96 130 Q92 139 104 142 H136 Q148 139 144 130 L128 105 V89" fill="#0A0A0A" stroke={color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M103 128 Q120 117 137 128 L142 137 H98 Z" fill={color} opacity="0.72" />
      <circle cx="103" cy="103" r="4" fill={color} />
      <circle cx="143" cy="94" r="6" fill="none" stroke={color} strokeWidth="3" />
    </svg>
  );
}

function SniperMask({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 240 170" className="role-mask-svg" aria-hidden="true">
      <path d={MASK_SHAPE} fill="#202020" stroke="#070707" strokeWidth="12" strokeLinejoin="round" />
      <path d={MASK_SHAPE} fill="none" stroke={color} strokeWidth="4" strokeLinejoin="round" />
      <path d="M50 69 Q76 54 100 68 Q81 83 58 81 Z" fill={color} opacity="0.75" />
      <circle cx="165" cy="70" r="25" fill="#090909" stroke={color} strokeWidth="4" />
      <circle cx="165" cy="70" r="11" fill="none" stroke={color} strokeWidth="3" />
      <path d="M165 37 V103 M132 70 H198" stroke={color} strokeWidth="3" />
      <path d="M67 125 H155" stroke={color} strokeWidth="7" strokeLinecap="round" />
      <path d="M155 119 L181 125 L155 131 Z" fill={color} />
      <path d="M81 116 V134" stroke="#111" strokeWidth="4" />
    </svg>
  );
}

export function RoleMaskEmblem({ roleKey, color }: RoleMaskEmblemProps) {
  if (roleKey === "الولد") return <KillerMask color={color} />;
  if (roleKey === "الإكة") return <SilencerMask color={color} />;
  if (roleKey === "الشايب") return <RevealerMask color={color} />;
  if (roleKey === "البنت") return <ProtectorMask color={color} />;
  if (roleKey === "المواطن") return <CitizenMask color={color} />;
  if (roleKey === "madman") return <MadmanMask color={color} />;
  if (roleKey === "twin") return <TwinMask color={color} />;
  if (roleKey === "avenger") return <AvengerMask color={color} />;
  if (roleKey === "magician") return <MagicianMask color={color} />;
  if (roleKey === "sniper") return <SniperMask color={color} />;

  return (
    <div className="role-mask-fallback" aria-hidden="true">
      <RoleIcon roleKey={roleKey} color={color} size={104} />
    </div>
  );
}
