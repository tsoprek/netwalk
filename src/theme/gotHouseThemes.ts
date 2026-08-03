import starkSigil from "../assets/got-houses/stark.png";
import lannisterSigil from "../assets/got-houses/lannister.png";
import targaryenSigil from "../assets/got-houses/targaryen.png";
import baratheonSigil from "../assets/got-houses/baratheon.png";
import tyrellSigil from "../assets/got-houses/tyrell.png";
import greyjoySigil from "../assets/got-houses/greyjoy.png";
import martellSigil from "../assets/got-houses/martell.png";
import arrynSigil from "../assets/got-houses/arryn.png";
import tullySigil from "../assets/got-houses/tully.png";

export type GotHouseTheme = {
  id: string;
  label: string;
  brandName: string;
  motto: string;
  accent: string;
  lightAccent?: string;
  darkAccent?: string;
  logoUrl: string;
  window: {
    bg: string;
    panel: string;
    fg: string;
    muted: string;
    border: string;
    inputBg: string;
    btnFg: string;
  };
  lightWindow: {
    bg: string;
    panel: string;
    fg: string;
    muted: string;
    border: string;
    inputBg: string;
    btnFg: string;
  };
  darkWindow: {
    bg: string;
    panel: string;
    fg: string;
    muted: string;
    border: string;
    inputBg: string;
    btnFg: string;
  };
};

const sigils = {
  stark: starkSigil,
  lannister: lannisterSigil,
  targaryen: targaryenSigil,
  baratheon: baratheonSigil,
  tyrell: tyrellSigil,
  greyjoy: greyjoySigil,
  martell: martellSigil,
  arryn: arrynSigil,
  tully: tullySigil,
};

export const GOT_HOUSE_THEMES: GotHouseTheme[] = [
  {
    id: "got-stark", label: "GoT · House Stark", brandName: "House Stark", motto: "Winter is coming",
    accent: "#b7c5c5", logoUrl: sigils.stark,
    window: { bg: "#202729", panel: "#303a3c", fg: "#f0f2ed", muted: "#a9b5b2", border: "#6f817c", inputBg: "#151a1b", btnFg: "#111617" },
    lightWindow: { bg: "#dfe7e3", panel: "#f4f1e8", fg: "#202c2e", muted: "#576966", border: "#839994", inputBg: "#fffdf7", btnFg: "#182024" },
    darkWindow: { bg: "#0c1415", panel: "#253234", fg: "#e8eeea", muted: "#9daca8", border: "#587069", inputBg: "#070d0e", btnFg: "#101515" },
  },
  {
    id: "got-lannister", label: "GoT · House Lannister", brandName: "House Lannister", motto: "Hear me roar",
    accent: "#e4b52d", logoUrl: sigils.lannister,
    window: { bg: "#260a0f", panel: "#46121b", fg: "#f7e8c4", muted: "#c5a589", border: "#8f6728", inputBg: "#170609", btnFg: "#1d070b" },
    lightWindow: { bg: "#f2ddd7", panel: "#fff0d5", fg: "#55121d", muted: "#8e5f58", border: "#c6963d", inputBg: "#fff8e8", btnFg: "#3c0b13" },
    darkWindow: { bg: "#160408", panel: "#3a0b14", fg: "#f6e1b8", muted: "#c19676", border: "#9b7023", inputBg: "#0c0204", btnFg: "#1b0407" },
  },
  {
    id: "got-targaryen", label: "GoT · House Targaryen", brandName: "House Targaryen", motto: "Fire and blood",
    accent: "#d52b38", logoUrl: sigils.targaryen,
    window: { bg: "#100d0e", panel: "#211719", fg: "#eee3df", muted: "#a58c8d", border: "#6d2027", inputBg: "#090708", btnFg: "#ffffff" },
    lightWindow: { bg: "#e9dedd", panel: "#f7ece9", fg: "#351418", muted: "#7d5f63", border: "#b87980", inputBg: "#fff7f4", btnFg: "#ffffff" },
    darkWindow: { bg: "#030303", panel: "#1d080b", fg: "#f2e7e4", muted: "#ad898c", border: "#701820", inputBg: "#000000", btnFg: "#ffffff" },
  },
  {
    id: "got-baratheon", label: "GoT · House Baratheon", brandName: "House Baratheon", motto: "Ours is the fury",
    accent: "#e1b52e", logoUrl: sigils.baratheon,
    window: { bg: "#1b1912", panel: "#302b19", fg: "#f4e8bd", muted: "#b8aa7d", border: "#8e7427", inputBg: "#100f0a", btnFg: "#141209" },
    lightWindow: { bg: "#eee2ad", panel: "#fff2c7", fg: "#282116", muted: "#71613b", border: "#b89a34", inputBg: "#fff8dc", btnFg: "#17130d" },
    darkWindow: { bg: "#100f08", panel: "#2b2510", fg: "#f3e8b8", muted: "#b6a66b", border: "#9a7d25", inputBg: "#080704", btnFg: "#11100b" },
  },
  {
    id: "got-tyrell", label: "GoT · House Tyrell", brandName: "House Tyrell", motto: "Growing strong",
    accent: "#e7bd32", logoUrl: sigils.tyrell,
    window: { bg: "#0d2116", panel: "#193a27", fg: "#f1efd7", muted: "#a9bfa5", border: "#807126", inputBg: "#07130d", btnFg: "#11170a" },
    lightWindow: { bg: "#dce9d5", panel: "#f4efd2", fg: "#173c24", muted: "#587158", border: "#91aa71", inputBg: "#fbf8e8", btnFg: "#18200d" },
    darkWindow: { bg: "#041109", panel: "#11301d", fg: "#eff2d8", muted: "#9caf91", border: "#857322", inputBg: "#020905", btnFg: "#11170a" },
  },
  {
    id: "got-greyjoy", label: "GoT · House Greyjoy", brandName: "House Greyjoy", motto: "We do not sow",
    accent: "#d6a51e", logoUrl: sigils.greyjoy,
    window: { bg: "#0d0f0e", panel: "#20241f", fg: "#eee4bd", muted: "#aaa48b", border: "#776322", inputBg: "#060706", btnFg: "#17150b" },
    lightWindow: { bg: "#dedbcc", panel: "#f3ecd2", fg: "#302e23", muted: "#6c6754", border: "#ad9b4f", inputBg: "#faf6e7", btnFg: "#17150b" },
    darkWindow: { bg: "#030403", panel: "#1b1c15", fg: "#eee4bd", muted: "#a19a7d", border: "#715d18", inputBg: "#010201", btnFg: "#17150b" },
  },
  {
    id: "got-martell", label: "GoT · House Martell", brandName: "House Martell", motto: "Unbowed, unbent, unbroken",
    accent: "#f1c232", logoUrl: sigils.martell,
    window: { bg: "#301108", panel: "#572214", fg: "#f8e6c9", muted: "#cda184", border: "#a56f22", inputBg: "#1c0904", btnFg: "#281006" },
    lightWindow: { bg: "#f3d3b5", panel: "#ffe7c5", fg: "#5d2415", muted: "#8e604e", border: "#c98643", inputBg: "#fff3df", btnFg: "#40150b" },
    darkWindow: { bg: "#200903", panel: "#4b1608", fg: "#ffe8c2", muted: "#d0a083", border: "#b47a20", inputBg: "#120401", btnFg: "#281006" },
  },
  {
    id: "got-arryn", label: "GoT · House Arryn", brandName: "House Arryn", motto: "As high as honor",
    accent: "#d6eaff", lightAccent: "#285f8f", darkAccent: "#9ed2f5", logoUrl: sigils.arryn,
    window: { bg: "#0d263e", panel: "#173f63", fg: "#f2f8fc", muted: "#a7bfd2", border: "#628dad", inputBg: "#081827", btnFg: "#102c47" },
    lightWindow: { bg: "#d9e9f4", panel: "#edf5f9", fg: "#193c5d", muted: "#58758d", border: "#8db6d3", inputBg: "#f8fcff", btnFg: "#153b61" },
    darkWindow: { bg: "#061522", panel: "#123758", fg: "#ebf7ff", muted: "#9abbd2", border: "#5b91ba", inputBg: "#030c13", btnFg: "#153b61" },
  },
  {
    id: "got-tully", label: "GoT · House Tully", brandName: "House Tully", motto: "Family, duty, honor",
    accent: "#d9e1e7", lightAccent: "#365f7d", logoUrl: sigils.tully,
    window: { bg: "#0e223b", panel: "#3f1722", fg: "#f0edf0", muted: "#b6aeb6", border: "#667f99", inputBg: "#081526", btnFg: "#142434" },
    lightWindow: { bg: "#dce5ee", panel: "#f2e4e2", fg: "#25394e", muted: "#657586", border: "#91a6ba", inputBg: "#faf3f1", btnFg: "#182737" },
    darkWindow: { bg: "#05101d", panel: "#3b121d", fg: "#edf1f4", muted: "#a8b2bc", border: "#617e99", inputBg: "#020812", btnFg: "#182737" },
  },
];
