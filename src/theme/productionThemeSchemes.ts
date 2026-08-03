import type { ThemeSchemeOverride } from "../api/appearance";

// Light / Medium / Dark window palettes derived from the production Catwalk
// configuration, with standalone-safe display names and only the themes that
// ConneCat exposes.
const PRODUCTION_OVERRIDES: Record<string, ThemeSchemeOverride> = {
      "cisco": {
        "defaultScheme": "medium",
        "label": "Ocean Blue",
        "schemes": {
          "dark": {
            "window": {
              "bg": "#00111d",
              "border": "#003d61",
              "btnFg": "#ffffff",
              "fg": "#eaf6fc",
              "inputBg": "#000d16",
              "muted": "#6e8ca7",
              "panel": "#001f33"
            }
          },
          "light": {
            "window": {
              "bg": "#f2f8fb",
              "border": "#a9cfdf",
              "btnFg": "#ffffff",
              "fg": "#102f40",
              "inputBg": "#f8fcfe",
              "muted": "#5f7b8b",
              "panel": "#ffffff"
            }
          },
          "medium": {
            "window": {
              "bg": "#00253d",
              "border": "#004d7a",
              "btnFg": "#ffffff",
              "fg": "#e5f1f8",
              "inputBg": "#253c4b",
              "muted": "#7d9bb8",
              "panel": "#003459"
            }
          }
        }
      },
      "got": {
        "defaultScheme": "medium",
        "label": "Game of Thrones",
        "schemes": {
          "dark": {
            "window": {
              "bg": "#090705",
              "border": "#3b260f",
              "btnFg": "#f5ead0",
              "fg": "#eee3ce",
              "inputBg": "#050403",
              "muted": "#847255",
              "panel": "#120d09"
            }
          },
          "light": {
            "window": {
              "bg": "#e9f2f7",
              "border": "#a9c3d1",
              "btnFg": "#ffffff",
              "fg": "#24313a",
              "inputBg": "#ffffff",
              "muted": "#687b88",
              "panel": "#f7fbfd"
            }
          },
          "medium": {
            "window": {
              "bg": "#15110d",
              "border": "#5a3a1a",
              "btnFg": "#f5ead0",
              "fg": "#e8dcc4",
              "inputBg": "#0d0a07",
              "muted": "#9a8868",
              "panel": "#241a12"
            }
          }
        }
      },
      "got-arryn": {
        "defaultScheme": "medium",
        "label": "GoT · House Arryn",
        "schemes": {
          "dark": {
            "window": {
              "bg": "#061522",
              "border": "#5b91ba",
              "btnFg": "#153b61",
              "fg": "#ebf7ff",
              "inputBg": "#030c13",
              "muted": "#9abbd2",
              "panel": "#123758"
            }
          },
          "light": {
            "window": {
              "bg": "#d9e9f4",
              "border": "#8db6d3",
              "btnFg": "#153b61",
              "fg": "#193c5d",
              "inputBg": "#f8fcff",
              "muted": "#58758d",
              "panel": "#edf5f9"
            }
          },
          "medium": {
            "window": {
              "bg": "#0d263e",
              "border": "#628dad",
              "btnFg": "#102c47",
              "fg": "#f2f8fc",
              "inputBg": "#081827",
              "muted": "#a7bfd2",
              "panel": "#173f63"
            }
          }
        }
      },
      "got-baratheon": {
        "defaultScheme": "medium",
        "label": "GoT · House Baratheon",
        "schemes": {
          "dark": {
            "window": {
              "bg": "#100f08",
              "border": "#9a7d25",
              "btnFg": "#11100b",
              "fg": "#f3e8b8",
              "inputBg": "#080704",
              "muted": "#b6a66b",
              "panel": "#2b2510"
            }
          },
          "light": {
            "window": {
              "bg": "#eee2ad",
              "border": "#b89a34",
              "btnFg": "#17130d",
              "fg": "#282116",
              "inputBg": "#fff8dc",
              "muted": "#71613b",
              "panel": "#fff2c7"
            }
          },
          "medium": {
            "window": {
              "bg": "#1b1912",
              "border": "#8e7427",
              "btnFg": "#141209",
              "fg": "#f4e8bd",
              "inputBg": "#100f0a",
              "muted": "#b8aa7d",
              "panel": "#302b19"
            }
          }
        }
      },
      "got-greyjoy": {
        "defaultScheme": "medium",
        "label": "GoT · House Greyjoy",
        "schemes": {
          "dark": {
            "window": {
              "bg": "#030403",
              "border": "#715d18",
              "btnFg": "#17150b",
              "fg": "#eee4bd",
              "inputBg": "#010201",
              "muted": "#a19a7d",
              "panel": "#1b1c15"
            }
          },
          "light": {
            "window": {
              "bg": "#dedbcc",
              "border": "#ad9b4f",
              "btnFg": "#17150b",
              "fg": "#302e23",
              "inputBg": "#faf6e7",
              "muted": "#6c6754",
              "panel": "#f3ecd2"
            }
          },
          "medium": {
            "window": {
              "bg": "#0d0f0e",
              "border": "#776322",
              "btnFg": "#17150b",
              "fg": "#eee4bd",
              "inputBg": "#060706",
              "muted": "#aaa48b",
              "panel": "#20241f"
            }
          }
        }
      },
      "got-lannister": {
        "defaultScheme": "medium",
        "label": "GoT · House Lannister",
        "schemes": {
          "dark": {
            "window": {
              "bg": "#160408",
              "border": "#9b7023",
              "btnFg": "#1b0407",
              "fg": "#f6e1b8",
              "inputBg": "#0c0204",
              "muted": "#c19676",
              "panel": "#3a0b14"
            }
          },
          "light": {
            "window": {
              "bg": "#f2ddd7",
              "border": "#c6963d",
              "btnFg": "#3c0b13",
              "fg": "#55121d",
              "inputBg": "#fff8e8",
              "muted": "#8e5f58",
              "panel": "#fff0d5"
            }
          },
          "medium": {
            "window": {
              "bg": "#260a0f",
              "border": "#8f6728",
              "btnFg": "#1d070b",
              "fg": "#f7e8c4",
              "inputBg": "#170609",
              "muted": "#c5a589",
              "panel": "#46121b"
            }
          }
        }
      },
      "got-martell": {
        "defaultScheme": "medium",
        "label": "GoT · House Martell",
        "schemes": {
          "dark": {
            "window": {
              "bg": "#200903",
              "border": "#b47a20",
              "btnFg": "#281006",
              "fg": "#ffe8c2",
              "inputBg": "#120401",
              "muted": "#d0a083",
              "panel": "#4b1608"
            }
          },
          "light": {
            "window": {
              "bg": "#f3d3b5",
              "border": "#c98643",
              "btnFg": "#40150b",
              "fg": "#5d2415",
              "inputBg": "#fff3df",
              "muted": "#8e604e",
              "panel": "#ffe7c5"
            }
          },
          "medium": {
            "window": {
              "bg": "#301108",
              "border": "#a56f22",
              "btnFg": "#281006",
              "fg": "#f8e6c9",
              "inputBg": "#1c0904",
              "muted": "#cda184",
              "panel": "#572214"
            }
          }
        }
      },
      "got-stark": {
        "defaultScheme": "medium",
        "label": "GoT · House Stark",
        "schemes": {
          "dark": {
            "window": {
              "bg": "#0c1415",
              "border": "#587069",
              "btnFg": "#101515",
              "fg": "#e8eeea",
              "inputBg": "#070d0e",
              "muted": "#9daca8",
              "panel": "#253234"
            }
          },
          "light": {
            "window": {
              "bg": "#dfe7e3",
              "border": "#839994",
              "btnFg": "#182024",
              "fg": "#202c2e",
              "inputBg": "#fffdf7",
              "muted": "#576966",
              "panel": "#f4f1e8"
            }
          },
          "medium": {
            "window": {
              "bg": "#202729",
              "border": "#6f817c",
              "btnFg": "#111617",
              "fg": "#f0f2ed",
              "inputBg": "#151a1b",
              "muted": "#a9b5b2",
              "panel": "#303a3c"
            }
          }
        }
      },
      "got-targaryen": {
        "defaultScheme": "medium",
        "label": "GoT · House Targaryen",
        "schemes": {
          "dark": {
            "window": {
              "bg": "#030303",
              "border": "#701820",
              "btnFg": "#ffffff",
              "fg": "#f2e7e4",
              "inputBg": "#000000",
              "muted": "#ad898c",
              "panel": "#1d080b"
            }
          },
          "light": {
            "window": {
              "bg": "#e9dedd",
              "border": "#b87980",
              "btnFg": "#ffffff",
              "fg": "#351418",
              "inputBg": "#fff7f4",
              "muted": "#7d5f63",
              "panel": "#f7ece9"
            }
          },
          "medium": {
            "window": {
              "bg": "#100d0e",
              "border": "#6d2027",
              "btnFg": "#ffffff",
              "fg": "#eee3df",
              "inputBg": "#090708",
              "muted": "#a58c8d",
              "panel": "#211719"
            }
          }
        }
      },
      "got-tully": {
        "defaultScheme": "medium",
        "label": "GoT · House Tully",
        "schemes": {
          "dark": {
            "window": {
              "bg": "#05101d",
              "border": "#617e99",
              "btnFg": "#182737",
              "fg": "#edf1f4",
              "inputBg": "#020812",
              "muted": "#a8b2bc",
              "panel": "#3b121d"
            }
          },
          "light": {
            "window": {
              "bg": "#dce5ee",
              "border": "#91a6ba",
              "btnFg": "#182737",
              "fg": "#25394e",
              "inputBg": "#faf3f1",
              "muted": "#657586",
              "panel": "#f2e4e2"
            }
          },
          "medium": {
            "window": {
              "bg": "#0e223b",
              "border": "#667f99",
              "btnFg": "#142434",
              "fg": "#f0edf0",
              "inputBg": "#081526",
              "muted": "#b6aeb6",
              "panel": "#3f1722"
            }
          }
        }
      },
      "got-tyrell": {
        "defaultScheme": "medium",
        "label": "GoT · House Tyrell",
        "schemes": {
          "dark": {
            "window": {
              "bg": "#041109",
              "border": "#857322",
              "btnFg": "#11170a",
              "fg": "#eff2d8",
              "inputBg": "#020905",
              "muted": "#9caf91",
              "panel": "#11301d"
            }
          },
          "light": {
            "window": {
              "bg": "#dce9d5",
              "border": "#91aa71",
              "btnFg": "#18200d",
              "fg": "#173c24",
              "inputBg": "#fbf8e8",
              "muted": "#587158",
              "panel": "#f4efd2"
            }
          },
          "medium": {
            "window": {
              "bg": "#0d2116",
              "border": "#807126",
              "btnFg": "#11170a",
              "fg": "#f1efd7",
              "inputBg": "#07130d",
              "muted": "#a9bfa5",
              "panel": "#193a27"
            }
          }
        }
      },
      "pride": {
        "defaultScheme": "medium",
        "label": "Pride",
        "schemes": {
          "dark": {
            "window": {
              "bg": "#0b0711",
              "border": "#5b249f",
              "btnFg": "#160d27",
              "fg": "#fbf5ff",
              "inputBg": "#060409",
              "muted": "#a887c8",
              "panel": "#160d27"
            }
          },
          "light": {
            "window": {
              "bg": "#fff7fb",
              "border": "#e3b9ec",
              "btnFg": "#24112d",
              "fg": "#2f1938",
              "inputBg": "#fffafd",
              "muted": "#765b7f",
              "panel": "#ffffff"
            }
          },
          "medium": {
            "window": {
              "bg": "#1a1426",
              "border": "#8338ec",
              "btnFg": "#1a1426",
              "fg": "#f8f0ff",
              "inputBg": "#120e1c",
              "muted": "#c8a5e8",
              "panel": "#2a1a4d"
            }
          }
        }
      },
      "squid": {
        "defaultScheme": "medium",
        "label": "Squid Game",
        "schemes": {
          "dark": {
            "window": {
              "bg": "#04100f",
              "border": "#9e164f",
              "btnFg": "#f8e8ec",
              "fg": "#fbedf1",
              "inputBg": "#020807",
              "muted": "#927f79",
              "panel": "#092521"
            }
          },
          "light": {
            "window": {
              "bg": "#f8f3f5",
              "border": "#e6a5c1",
              "btnFg": "#ffffff",
              "fg": "#183f3b",
              "inputBg": "#fffafb",
              "muted": "#766a6e",
              "panel": "#ffffff"
            }
          },
          "medium": {
            "window": {
              "bg": "#0d2724",
              "border": "#ed1b76",
              "btnFg": "#0d2724",
              "fg": "#f8e8ec",
              "inputBg": "#061412",
              "muted": "#a3938a",
              "panel": "#134641"
            }
          }
        }
      },
      "thousandeyes-steel": {
        "defaultScheme": "medium",
        "label": "Steel Horizon",
        "schemes": {
          "dark": {
            "window": {
              "bg": "#101a29",
              "border": "#2e435e",
              "btnFg": "#0e1422",
              "fg": "#e3e9f2",
              "inputBg": "#0d1724",
              "muted": "#8798b3",
              "panel": "#19263a"
            }
          },
          "light": {
            "window": {
              "bg": "#f4f7fa",
              "border": "#bdcbd9",
              "btnFg": "#0e1422",
              "fg": "#24364a",
              "inputBg": "#f8fafc",
              "muted": "#667a90",
              "panel": "#ffffff"
            }
          },
          "medium": {
            "window": {
              "bg": "#2a3e5c",
              "border": "#4a6485",
              "btnFg": "#0e1422",
              "fg": "#e3e9f2",
              "inputBg": "#3e4d6a",
              "muted": "#9cadc7",
              "panel": "#324a6b"
            }
          }
        }
      }
};

// Preserve the IDs used by early standalone builds while resolving them to
// the corresponding production palette. New selections use production IDs.
export const PRODUCTION_THEME_SCHEME_OVERRIDES: Record<string, ThemeSchemeOverride> = {
  ...PRODUCTION_OVERRIDES,
  connecat: PRODUCTION_OVERRIDES.cisco,
  "steel-horizon": PRODUCTION_OVERRIDES["thousandeyes-steel"],
};
