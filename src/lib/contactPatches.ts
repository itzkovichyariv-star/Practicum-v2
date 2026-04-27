/** Known contact details — applied at startup and in ManagementPage.
 *  Single source of truth; import from here rather than defining inline.
 */
export const CONTACT_PATCHES: Record<string, { name?: string; phone?: string; email?: string }> = {
  'אורית':                    { name: 'אורית שמש',         phone: '050-6694104',  email: 'orits@manpower.co.il'    },
  'מרכז סימולציות':           {                             phone: '050-990-1858', email: 'noashron@gmail.com'      },
  'נועה שמיר':                {                             phone: '050-990-1858', email: 'noashron@gmail.com'      },
  'למלם':                     {                             phone: '053-8306228'                                    },
  'פא״י':                    { name: 'יניב אלטראס (פא״י)', phone: '052-6324476'                                    },
  'יניב אלטראס (פא״י)':      {                             phone: '052-6324476'                                    },
  'סימונה עמיר':              {                             phone: '050-7214426',  email: 'simonaami@telhai.ac.il' },
  'למא אבו אחמד (אינבידיה)':  {                             phone: '052-889-1960', email: 'labuahmad@nvidia.com'    },
  'חיה וגנר מישורי':          {                             phone: '054-7004049',  email: 'hayawagner@gmail.com'   },
  'אופיר קרקו':               {                             phone: '050-4014350',  email: 'ofirk@nishapro.co.il'   },
  'איילה ראובן ללונג':        {                             phone: '054-4805614',  email: 'Ayalla@eq-el.co.il'      },
  'ענבל בנימין אלרן':         {                             phone: '054-7889607'                                    },
  'שלה דיין':                 {                             phone: '054-811-1247', email: 'shelladh@gmail.com'      },
};
