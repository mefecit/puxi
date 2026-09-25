{
 "patcher": {
  "fileversion": 1,
  "appversion": {
   "major": 8,
   "minor": 6,
   "revision": 0,
   "architecture": "x64",
   "modernui": 1
  },
  "classnamespace": "box",
  "rect": [
   80.0,
   100.0,
   1200.0,
   480.0
  ],
  "bglocked": 0,
  "openinpresentation": 1,
  "default_fontsize": 12.0,
  "default_fontface": 0,
  "default_fontname": "Arial",
  "gridonopen": 1,
  "gridsize": [
   15.0,
   15.0
  ],
  "gridsnaponopen": 1,
  "objectsnaponopen": 1,
  "statusbarvisible": 2,
  "toolbarvisible": 1,
  "boxes": [
   {
    "box": {
     "id": "obj-1",
     "maxclass": "newobj",
     "patching_rect": [
      30,
      40,
      46,
      22
     ],
     "text": "midiin",
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      "int"
     ]
    }
   },
   {
    "box": {
     "id": "obj-2",
     "maxclass": "newobj",
     "patching_rect": [
      30,
      330,
      50,
      22
     ],
     "text": "midiout",
     "numinlets": 1,
     "numoutlets": 0
    }
   },
   {
    "box": {
     "id": "obj-3",
     "maxclass": "newobj",
     "patching_rect": [
      130,
      40,
      98,
      22
     ],
     "text": "live.thisdevice",
     "numinlets": 1,
     "numoutlets": 3,
     "outlettype": [
      "bang",
      "int",
      "int"
     ]
    }
   },
   {
    "box": {
     "id": "obj-4",
     "maxclass": "message",
     "patching_rect": [
      130,
      80,
      33,
      22
     ],
     "text": "init",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ]
    }
   },
   {
    "box": {
     "id": "obj-5",
     "maxclass": "newobj",
     "patching_rect": [
      300,
      40,
      170,
      22
     ],
     "text": "metro 16n @quantize 16n @active 1",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      "bang"
     ]
    }
   },
   {
    "box": {
     "id": "obj-6",
     "maxclass": "message",
     "patching_rect": [
      300,
      80,
      33,
      22
     ],
     "text": "tick",
     "numinlets": 2,
     "numoutlets": 1,
     "outlettype": [
      ""
     ]
    }
   },
   {
    "box": {
     "id": "obj-7",
     "maxclass": "newobj",
     "patching_rect": [
      130,
      140,
      110,
      22
     ],
     "text": "v8 puxi-engine.js",
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "varname": "engine"
    }
   },
   {
    "box": {
     "id": "obj-8",
     "maxclass": "newobj",
     "patching_rect": [
      130,
      230,
      110,
      22
     ],
     "text": "makenote 100 120",
     "numinlets": 3,
     "numoutlets": 2,
     "outlettype": [
      "int",
      "int"
     ]
    }
   },
   {
    "box": {
     "id": "obj-9",
     "maxclass": "newobj",
     "patching_rect": [
      130,
      330,
      52,
      22
     ],
     "text": "noteout",
     "numinlets": 3,
     "numoutlets": 0
    }
   },
   {
    "box": {
     "id": "obj-10",
     "maxclass": "v8ui",
     "filename": "puxi-gui.js",
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "parameter_enable": 0,
     "border": 0,
     "patching_rect": [
      430.0,
      140.0,
      740.0,
      160.0
     ],
     "presentation": 1,
     "presentation_rect": [
      8.0,
      8.0,
      740.0,
      160.0
     ]
    }
   },
   {
    "box": {
     "id": "obj-20",
     "maxclass": "comment",
     "patching_rect": [
      30,
      10,
      140,
      20
     ],
     "text": "MIDI passthrough"
    }
   },
   {
    "box": {
     "id": "obj-21",
     "maxclass": "comment",
     "patching_rect": [
      130,
      115,
      210,
      20
     ],
     "text": "engine: state + step logic (v8/JS)"
    }
   },
   {
    "box": {
     "id": "obj-22",
     "maxclass": "comment",
     "patching_rect": [
      300,
      10,
      200,
      20
     ],
     "text": "clock: fires every 16n while playing"
    }
   },
   {
    "box": {
     "id": "obj-23",
     "maxclass": "comment",
     "patching_rect": [
      430,
      115,
      260,
      20
     ],
     "text": "GUI: 8x8 grid (v8ui, presentation mode)"
    }
   },
   {
    "box": {
     "id": "obj-30",
     "maxclass": "live.toggle",
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "parameter_enable": 1,
     "patching_rect": [
      520.0,
      40.0,
      24.0,
      24.0
     ],
     "presentation": 1,
     "presentation_rect": [
      10.0,
      4.0,
      24.0,
      24.0
     ],
     "saved_attribute_attributes": {
      "valueof": {
       "parameter_enum": [
        "off",
        "ON"
       ],
       "parameter_longname": "Follow",
       "parameter_mmax": 1,
       "parameter_mapping_index": 1,
       "parameter_modmode": 0,
       "parameter_shortname": "Follow",
       "parameter_type": 2,
       "parameter_initial": [
        1
       ],
       "parameter_initial_enable": 1
      }
     },
     "varname": "p_follow"
    }
   },
   {
    "box": {
     "id": "obj-31",
     "maxclass": "live.numbox",
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "",
      "float"
     ],
     "parameter_enable": 1,
     "patching_rect": [
      560.0,
      40.0,
      50.0,
      22.0
     ],
     "presentation": 1,
     "presentation_rect": [
      -80.0,
      34.0,
      50.0,
      22.0
     ],
     "saved_attribute_attributes": {
      "valueof": {
       "parameter_initial": [
        1
       ],
       "parameter_initial_enable": 1,
       "parameter_longname": "Loop Start",
       "parameter_mmax": 64,
       "parameter_mmin": 1,
       "parameter_mapping_index": 2,
       "parameter_modmode": 0,
       "parameter_shortname": "Start",
       "parameter_type": 1,
       "parameter_unitstyle": 0
      }
     },
     "varname": "p_loopstart"
    }
   },
   {
    "box": {
     "id": "obj-32",
     "maxclass": "live.numbox",
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "",
      "float"
     ],
     "parameter_enable": 1,
     "patching_rect": [
      620.0,
      40.0,
      50.0,
      22.0
     ],
     "presentation": 1,
     "presentation_rect": [
      -80.0,
      60.0,
      50.0,
      22.0
     ],
     "saved_attribute_attributes": {
      "valueof": {
       "parameter_initial": [
        8
       ],
       "parameter_initial_enable": 1,
       "parameter_longname": "Loop End",
       "parameter_mmax": 64,
       "parameter_mmin": 1,
       "parameter_mapping_index": 3,
       "parameter_modmode": 0,
       "parameter_shortname": "End",
       "parameter_type": 1,
       "parameter_unitstyle": 0
      }
     },
     "varname": "p_loopend"
    }
   },
   {
    "box": {
     "id": "obj-34",
     "maxclass": "live.numbox",
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "",
      "float"
     ],
     "parameter_enable": 1,
     "patching_rect": [
      740.0,
      40.0,
      50.0,
      22.0
     ],
     "presentation": 1,
     "presentation_rect": [
      -80.0,
      112.0,
      50.0,
      22.0
     ],
     "saved_attribute_attributes": {
      "valueof": {
       "parameter_initial": [
        100
       ],
       "parameter_initial_enable": 1,
       "parameter_longname": "Prob",
       "parameter_mmax": 100,
       "parameter_mmin": 0,
       "parameter_mapping_index": 5,
       "parameter_modmode": 0,
       "parameter_shortname": "Prob",
       "parameter_type": 1,
       "parameter_unitstyle": 0
      }
     },
     "varname": "p_prob"
    }
   },
   {
    "box": {
     "id": "obj-51",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      540.0,
      360.0,
      110,
      22.0
     ],
     "text": "prepend set"
    }
   },
   {
    "box": {
     "id": "obj-52",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      740.0,
      90.0,
      110,
      22.0
     ],
     "text": "prepend pprob"
    }
   },
   {
    "box": {
     "id": "obj-35",
     "maxclass": "live.numbox",
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "",
      "float"
     ],
     "parameter_enable": 1,
     "patching_rect": [
      800.0,
      40.0,
      50.0,
      22.0
     ],
     "presentation": 1,
     "presentation_rect": [
      -80.0,
      138.0,
      50.0,
      22.0
     ],
     "saved_attribute_attributes": {
      "valueof": {
       "parameter_initial": [
        100
       ],
       "parameter_initial_enable": 1,
       "parameter_longname": "Length",
       "parameter_mmax": 6400,
       "parameter_mmin": 5,
       "parameter_mapping_index": 6,
       "parameter_modmode": 0,
       "parameter_shortname": "Length",
       "parameter_type": 0,
       "parameter_unitstyle": 0
      }
     },
     "varname": "p_length"
    }
   },
   {
    "box": {
     "id": "obj-53",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      600.0,
      360.0,
      110,
      22.0
     ],
     "text": "prepend set"
    }
   },
   {
    "box": {
     "id": "obj-54",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      800.0,
      90.0,
      110,
      22.0
     ],
     "text": "prepend plength"
    }
   },
   {
    "box": {
     "id": "obj-40",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      520.0,
      90.0,
      110,
      22.0
     ],
     "text": "prepend pfollow"
    }
   },
   {
    "box": {
     "id": "obj-41",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      560.0,
      120.0,
      110,
      22.0
     ],
     "text": "prepend pstart"
    }
   },
   {
    "box": {
     "id": "obj-42",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      620.0,
      150.0,
      110,
      22.0
     ],
     "text": "prepend pend"
    }
   },
   {
    "box": {
     "id": "obj-43",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 10,
     "outlettype": [
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      ""
     ],
     "patching_rect": [
      300.0,
      200.0,
      210.0,
      22.0
     ],
     "text": "route follow start end state prob length plock1 plock2 vel"
    }
   },
   {
    "box": {
     "id": "obj-44",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      300.0,
      240.0,
      110,
      22.0
     ],
     "text": "prepend set"
    }
   },
   {
    "box": {
     "id": "obj-45",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      360.0,
      270.0,
      110,
      22.0
     ],
     "text": "prepend set"
    }
   },
   {
    "box": {
     "id": "obj-46",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      420.0,
      300.0,
      110,
      22.0
     ],
     "text": "prepend set"
    }
   },
   {
    "box": {
     "id": "obj-50",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 4,
     "outlettype": [
      "",
      "",
      "",
      ""
     ],
     "patching_rect": [
      130.0,
      178.0,
      150.0,
      22.0
     ],
     "text": "route note gui param"
    }
   },
   {
    "box": {
     "id": "obj-60",
     "maxclass": "newobj",
     "text": "p pstate",
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      900.0,
      140.0,
      80.0,
      22.0
     ],
     "patcher": {
      "fileversion": 1,
      "rect": [
       0.0,
       0.0,
       400.0,
       300.0
      ],
      "boxes": [
       {
        "box": {
         "id": "obj-1",
         "maxclass": "inlet",
         "numinlets": 0,
         "numoutlets": 1,
         "outlettype": [
          ""
         ],
         "patching_rect": [
          60.0,
          40.0,
          30.0,
          30.0
         ]
        }
       },
       {
        "box": {
         "id": "obj-3",
         "maxclass": "newobj",
         "text": "pattr PuxiState",
         "numinlets": 1,
         "numoutlets": 3,
         "outlettype": [
          "",
          "",
          ""
         ],
         "patching_rect": [
          60.0,
          120.0,
          170.0,
          22.0
         ],
         "saved_object_attributes": {
          "initial": [
           1,
           0
          ],
          "parameter_enable": 1,
          "parameter_mappable": 0
         },
         "saved_attribute_attributes": {
          "valueof": {
           "parameter_initial": [
            1,
            0
           ],
           "parameter_initial_enable": 1,
           "parameter_invisible": 1,
           "parameter_longname": "PuxiState",
           "parameter_mappable": 0,
           "parameter_modmode": 0,
           "parameter_shortname": "PuxiState",
           "parameter_type": 3
          }
         },
         "varname": "PuxiState"
        }
       },
       {
        "box": {
         "id": "obj-4",
         "maxclass": "newobj",
         "text": "prepend pstate",
         "numinlets": 1,
         "numoutlets": 1,
         "outlettype": [
          ""
         ],
         "patching_rect": [
          60.0,
          160.0,
          95.0,
          22.0
         ]
        }
       },
       {
        "box": {
         "id": "obj-5",
         "maxclass": "outlet",
         "numinlets": 1,
         "numoutlets": 0,
         "patching_rect": [
          60.0,
          200.0,
          30.0,
          30.0
         ]
        }
       }
      ],
      "lines": [
       {
        "patchline": {
         "source": [
          "obj-1",
          0
         ],
         "destination": [
          "obj-3",
          0
         ]
        }
       },
       {
        "patchline": {
         "source": [
          "obj-3",
          0
         ],
         "destination": [
          "obj-4",
          0
         ]
        }
       },
       {
        "patchline": {
         "source": [
          "obj-4",
          0
         ],
         "destination": [
          "obj-5",
          0
         ]
        }
       }
      ]
     }
    }
   },
   {
    "box": {
     "id": "obj-70",
     "maxclass": "live.numbox",
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "",
      "float"
     ],
     "parameter_enable": 1,
     "patching_rect": [
      960.0,
      40.0,
      50.0,
      22.0
     ],
     "presentation": 1,
     "presentation_rect": [
      -80.0,
      166.0,
      50.0,
      22.0
     ],
     "saved_attribute_attributes": {
      "valueof": {
       "parameter_initial": [
        0
       ],
       "parameter_initial_enable": 1,
       "parameter_longname": "Lock 1",
       "parameter_mmax": 127,
       "parameter_mmin": 0,
       "parameter_mapping_index": 7,
       "parameter_modmode": 0,
       "parameter_shortname": "Lock1",
       "parameter_type": 1,
       "parameter_unitstyle": 0
      }
     },
     "varname": "p_lock1"
    }
   },
   {
    "box": {
     "id": "obj-71",
     "maxclass": "live.numbox",
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "",
      "float"
     ],
     "parameter_enable": 1,
     "patching_rect": [
      1060.0,
      40.0,
      50.0,
      22.0
     ],
     "presentation": 1,
     "presentation_rect": [
      -80.0,
      194.0,
      50.0,
      22.0
     ],
     "saved_attribute_attributes": {
      "valueof": {
       "parameter_initial": [
        0
       ],
       "parameter_initial_enable": 1,
       "parameter_longname": "Lock 2",
       "parameter_mmax": 127,
       "parameter_mmin": 0,
       "parameter_mapping_index": 8,
       "parameter_modmode": 0,
       "parameter_shortname": "Lock2",
       "parameter_type": 1,
       "parameter_unitstyle": 0
      }
     },
     "varname": "p_lock2"
    }
   },
   {
    "box": {
     "id": "obj-72",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      960.0,
      360.0,
      120,
      22.0
     ],
     "text": "prepend set"
    }
   },
   {
    "box": {
     "id": "obj-73",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      1060.0,
      360.0,
      120,
      22.0
     ],
     "text": "prepend set"
    }
   },
   {
    "box": {
     "id": "obj-74",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      960.0,
      90.0,
      120,
      22.0
     ],
     "text": "prepend pplock1"
    }
   },
   {
    "box": {
     "id": "obj-75",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      1060.0,
      90.0,
      120,
      22.0
     ],
     "text": "prepend pplock2"
    }
   },
   {
    "box": {
     "id": "obj-80",
     "maxclass": "live.numbox",
     "numinlets": 1,
     "numoutlets": 2,
     "outlettype": [
      "",
      "float"
     ],
     "parameter_enable": 1,
     "patching_rect": [
      420.0,
      40.0,
      50.0,
      22.0
     ],
     "presentation": 1,
     "presentation_rect": [
      -80.0,
      222.0,
      50.0,
      22.0
     ],
     "saved_attribute_attributes": {
      "valueof": {
       "parameter_initial": [
        100
       ],
       "parameter_initial_enable": 1,
       "parameter_longname": "Vel",
       "parameter_mmax": 127,
       "parameter_mmin": 1,
       "parameter_mapping_index": 4,
       "parameter_modmode": 0,
       "parameter_shortname": "Vel",
       "parameter_type": 1,
       "parameter_unitstyle": 0
      }
     },
     "varname": "p_vel"
    }
   },
   {
    "box": {
     "id": "obj-81",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      420.0,
      360.0,
      110,
      22.0
     ],
     "text": "prepend set"
    }
   },
   {
    "box": {
     "id": "obj-82",
     "maxclass": "newobj",
     "numinlets": 1,
     "numoutlets": 1,
     "outlettype": [
      ""
     ],
     "patching_rect": [
      420.0,
      90.0,
      110,
      22.0
     ],
     "text": "prepend pvel"
    }
   }
  ],
  "lines": [
   {
    "patchline": {
     "source": [
      "obj-1",
      0
     ],
     "destination": [
      "obj-2",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-3",
      0
     ],
     "destination": [
      "obj-4",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-4",
      0
     ],
     "destination": [
      "obj-7",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-5",
      0
     ],
     "destination": [
      "obj-6",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-6",
      0
     ],
     "destination": [
      "obj-7",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-8",
      0
     ],
     "destination": [
      "obj-9",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-8",
      1
     ],
     "destination": [
      "obj-9",
      1
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-10",
      0
     ],
     "destination": [
      "obj-7",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-30",
      0
     ],
     "destination": [
      "obj-40",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-40",
      0
     ],
     "destination": [
      "obj-7",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-31",
      0
     ],
     "destination": [
      "obj-41",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-41",
      0
     ],
     "destination": [
      "obj-7",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-32",
      0
     ],
     "destination": [
      "obj-42",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-42",
      0
     ],
     "destination": [
      "obj-7",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-44",
      0
     ],
     "destination": [
      "obj-30",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-45",
      0
     ],
     "destination": [
      "obj-31",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-46",
      0
     ],
     "destination": [
      "obj-32",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-7",
      0
     ],
     "destination": [
      "obj-50",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-50",
      0
     ],
     "destination": [
      "obj-8",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-50",
      1
     ],
     "destination": [
      "obj-10",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-50",
      2
     ],
     "destination": [
      "obj-43",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-60",
      0
     ],
     "destination": [
      "obj-7",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-51",
      0
     ],
     "destination": [
      "obj-34",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-34",
      0
     ],
     "destination": [
      "obj-52",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-52",
      0
     ],
     "destination": [
      "obj-7",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-53",
      0
     ],
     "destination": [
      "obj-35",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-35",
      0
     ],
     "destination": [
      "obj-54",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-54",
      0
     ],
     "destination": [
      "obj-7",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-72",
      0
     ],
     "destination": [
      "obj-70",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-70",
      0
     ],
     "destination": [
      "obj-74",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-74",
      0
     ],
     "destination": [
      "obj-7",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-73",
      0
     ],
     "destination": [
      "obj-71",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-71",
      0
     ],
     "destination": [
      "obj-75",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-75",
      0
     ],
     "destination": [
      "obj-7",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-43",
      0
     ],
     "destination": [
      "obj-44",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-43",
      1
     ],
     "destination": [
      "obj-45",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-43",
      2
     ],
     "destination": [
      "obj-46",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-43",
      3
     ],
     "destination": [
      "obj-60",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-43",
      4
     ],
     "destination": [
      "obj-51",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-43",
      5
     ],
     "destination": [
      "obj-53",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-43",
      6
     ],
     "destination": [
      "obj-72",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-43",
      7
     ],
     "destination": [
      "obj-73",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-43",
      8
     ],
     "destination": [
      "obj-81",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-81",
      0
     ],
     "destination": [
      "obj-80",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-80",
      0
     ],
     "destination": [
      "obj-82",
      0
     ]
    }
   },
   {
    "patchline": {
     "source": [
      "obj-82",
      0
     ],
     "destination": [
      "obj-7",
      0
     ]
    }
   }
  ],
  "parameters": {
   "obj-30": [
    "Follow",
    "Follow",
    0
   ],
   "obj-31": [
    "Loop Start",
    "Start",
    0
   ],
   "obj-32": [
    "Loop End",
    "End",
    0
   ],
   "obj-34": [
    "Prob",
    "Prob",
    0
   ],
   "obj-35": [
    "Length",
    "Length",
    0
   ],
   "obj-60::obj-3": [
    "PuxiState",
    "PuxiState",
    0
   ],
   "obj-70": [
    "Lock 1",
    "Lock1",
    0
   ],
   "obj-71": [
    "Lock 2",
    "Lock2",
    0
   ],
   "obj-80": [
    "Vel",
    "Vel",
    0
   ]
  },
  "dependency_cache": [],
  "autosave": 0
 }
}