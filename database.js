// database.js - Die zentrale Stammdatenbank für PVPro
// Hier kannst du jederzeit neue Module oder Wechselrichter eintragen!

const MasterDB = {
    panels: [
        { id: 1, name: "Jolywood JW-HD96N", pmax: 440, voc: 34.51, isc: 15.72, vmp: 29.62, tempVoc: -0.250 },
        { id: 2, name: "Jolywood JW-HD120N", pmax: 500, voc: 43.58, isc: 14.12, vmp: 37.47, tempVoc: -0.250 },
        { id: 3, name: "AIKO Neostar 3S+", pmax: 470, voc: 40.70, isc: 14.72, vmp: 34.30, tempVoc: -0.220 },
        { id: 4, name: "Trina Vertex S+ (NEG9R.28)", pmax: 440, voc: 52.20, isc: 10.67, vmp: 44.00, tempVoc: -0.240 }
    ],
    batteries: [
        { id: 1, name: "Ohne Batterie", cap: 0, power: 0 },
        { id: 2, name: "Fronius Reserva 9.5", cap: 9.47, power: 11682 },
        { id: 3, name: "BYD Battery-Box HVS 10.2", cap: 10.24, power: 10000 },
        { id: 4, name: "Anker Intern (1.6)", cap: 1.6, power: 1000 },
        { id: 5, name: "Anker BP1600 (Erweiterung)", cap: 1.6, power: 2000 }
    ],
    inverters: [
        {
            id: 1, name: "Fronius Symo GEN24 12.0 SC", acMax: 12000, startV: 80, batteryId: 2,
            mppts: [{ id: 1, name: "MPPT 1", maxIsc: 40, maxV: 1000 }, { id: 2, name: "MPPT 2", maxIsc: 20, maxV: 1000 }]
        },
        {
            id: 2, name: "Anker SOLIX 2 E1600 Pro", acMax: 800, startV: 16, batteryId: 4,
            mppts: [{ id: 1, name: "Tracker 1", maxIsc: 16, maxV: 60 }, { id: 2, name: "Tracker 2", maxIsc: 16, maxV: 60 }, { id: 3, name: "Tracker 3", maxIsc: 16, maxV: 60 }, { id: 4, name: "Tracker 4", maxIsc: 16, maxV: 60 }]
        }
    ]
};
