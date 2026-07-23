// database.js - Die zentrale Stammdatenbank für PVPro (v4.0)

const MasterDB = {
    panels: [
        { series: "AIKO Neostar 3S+54", models: [
            { id: 101, name: "AIKO-A460-MCE54Db", pmax: 460, voc: 40.50, vmp: 34.10, isc: 14.66, tempVoc: -0.22 },
            { id: 102, name: "AIKO-A465-MCE54Db", pmax: 465, voc: 40.60, vmp: 34.20, isc: 14.69, tempVoc: -0.22 },
            { id: 103, name: "AIKO-A470-MCE54Db", pmax: 470, voc: 40.70, vmp: 34.30, isc: 14.72, tempVoc: -0.22 },
            { id: 104, name: "AIKO-A475-MCE54Db", pmax: 475, voc: 40.80, vmp: 34.40, isc: 14.76, tempVoc: -0.22 }
        ]},
        { series: "Jolywood JW-HD96N-R2", models: [
            { id: 201, name: "HD96N-R2 435W", pmax: 435, voc: 34.31, vmp: 29.44, isc: 15.65, tempVoc: -0.25 },
            { id: 202, name: "HD96N-R2 440W", pmax: 440, voc: 34.51, vmp: 29.62, isc: 15.72, tempVoc: -0.25 },
            { id: 203, name: "HD96N-R2 450W", pmax: 450, voc: 34.91, vmp: 29.98, isc: 15.86, tempVoc: -0.25 },
            { id: 204, name: "HD96N-R2 460W", pmax: 460, voc: 35.31, vmp: 30.34, isc: 16.00, tempVoc: -0.25 }
        ]},
        { series: "Jolywood JW-HD120N-R3", models: [
            { id: 301, name: "HD120N-R3 485W", pmax: 485, voc: 42.98, vmp: 36.93, isc: 13.94, tempVoc: -0.25 },
            { id: 302, name: "HD120N-R3 495W", pmax: 495, voc: 43.38, vmp: 37.29, isc: 14.06, tempVoc: -0.25 },
            { id: 303, name: "HD120N-R3 510W", pmax: 510, voc: 43.98, vmp: 37.83, isc: 14.24, tempVoc: -0.25 }
        ]}
    ],
    batteries: [
        { id: 1, name: "Ohne Batterie", cap: 0, power: 0 },
        { id: 2, name: "Fronius Reserva 9.5", cap: 9.47, power: 11682 },
        { id: 3, name: "BYD Battery-Box HVS 10.2", cap: 10.24, power: 10000 },
        { id: 4, name: "Anker Intern (1.6)", cap: 1.6, power: 1000 }
    ],
    inverters: [
        { series: "Fronius Symo GEN24 Plus", models: [
            { id: 10, name: "GEN24 3.0 Plus", acMax: 3000, startV: 80, minMppV: 125, maxMppV: 800, maxV: 1000, batteryId: 2, mppts: [{id:1, name:"MPPT 1", maxIsc: 20, maxI: 12.5}, {id:2, name:"MPPT 2", maxIsc: 20, maxI: 12.5}] },
            { id: 11, name: "GEN24 4.0 Plus", acMax: 4000, startV: 80, minMppV: 170, maxMppV: 800, maxV: 1000, batteryId: 2, mppts: [{id:1, name:"MPPT 1", maxIsc: 20, maxI: 12.5}, {id:2, name:"MPPT 2", maxIsc: 20, maxI: 12.5}] },
            { id: 12, name: "GEN24 5.0 Plus", acMax: 5000, startV: 80, minMppV: 210, maxMppV: 800, maxV: 1000, batteryId: 2, mppts: [{id:1, name:"MPPT 1", maxIsc: 20, maxI: 12.5}, {id:2, name:"MPPT 2", maxIsc: 20, maxI: 12.5}] },
            { id: 13, name: "GEN24 6.0 Plus", acMax: 6000, startV: 80, minMppV: 174, maxMppV: 800, maxV: 1000, batteryId: 2, mppts: [{id:1, name:"MPPT 1", maxIsc: 40, maxI: 25}, {id:2, name:"MPPT 2", maxIsc: 20, maxI: 12.5}] },
            { id: 14, name: "GEN24 8.0 Plus", acMax: 8000, startV: 80, minMppV: 224, maxMppV: 800, maxV: 1000, batteryId: 2, mppts: [{id:1, name:"MPPT 1", maxIsc: 40, maxI: 25}, {id:2, name:"MPPT 2", maxIsc: 20, maxI: 12.5}] },
            { id: 15, name: "GEN24 10.0 Plus", acMax: 10000, startV: 80, minMppV: 278, maxMppV: 800, maxV: 1000, batteryId: 2, mppts: [{id:1, name:"MPPT 1", maxIsc: 40, maxI: 25}, {id:2, name:"MPPT 2", maxIsc: 20, maxI: 12.5}] },
            { id: 16, name: "GEN24 12.0 SC Plus", acMax: 12000, startV: 80, minMppV: 295, maxMppV: 800, maxV: 1000, batteryId: 2, mppts: [{id:1, name:"MPPT 1", maxIsc: 40, maxI: 28}, {id:2, name:"MPPT 2", maxIsc: 20, maxI: 14}] }
        ]}
    ]
};
