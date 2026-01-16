let map = L.map('map', { zoomControl: false }).setView([20, 78], 5);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(map);

let allAirports = [];
let selectedFrom = null, selectedTo = null;
let flightPath = null;
let airportLayer = L.layerGroup().addTo(map);
let isCameraLocked = true;

// 1. Initialization & Search
async function init() {
    try {
        const res = await fetch('https://raw.githubusercontent.com/mwgg/Airports/master/airports.json');
        const data = await res.json();
        allAirports = Object.values(data).filter(ap => ap.iata && ap.iata.length === 3);
        setupSearch('fromInput', 'fromSuggestions', 'from');
        setupSearch('toInput', 'toSuggestions', 'to');
        renderMarkers();
    } catch (e) { console.error(e); }
}

function renderMarkers() {
    map.on('moveend', () => {
        airportLayer.clearLayers();
        const zoom = map.getZoom();
        allAirports.forEach(ap => {
            if (zoom >= 6 || ["LHR", "JFK", "DEL", "MAA", "BOM", "SIN"].includes(ap.iata)) {
                if (map.getBounds().contains([ap.lat, ap.lon])) {
                    const m = L.circleMarker([ap.lat, ap.lon], { color: '#4fc3f7', radius: zoom >= 6 ? 4 : 2 });
                    m.on('click', () => handleMapClick(ap));
                    airportLayer.addLayer(m);
                }
            }
        });
    });
}

function setupSearch(inputId, suggestionId, type) {
    const input = document.getElementById(inputId);
    const box = document.getElementById(suggestionId);
    input.addEventListener('input', (e) => {
        const val = e.target.value.toLowerCase();
        box.innerHTML = '';
        if (val.length < 2) { box.classList.add('hidden'); return; }
        const matches = allAirports.filter(ap => ap.city.toLowerCase().includes(val) || ap.iata.toLowerCase().includes(val)).slice(0, 10);
        matches.forEach(ap => {
            const item = document.createElement('div');
            item.className = 'suggestion-item';
            item.innerText = `${ap.city} (${ap.iata})`;
            item.onclick = () => {
                input.value = ap.city;
                box.classList.add('hidden');
                if (type === 'from') selectedFrom = ap; else selectedTo = ap;
                checkBoarding();
            };
            box.appendChild(item);
        });
        box.classList.remove('hidden');
    });
}

function handleMapClick(ap) {
    if (!selectedFrom) {
        selectedFrom = ap;
        document.getElementById('fromInput').value = ap.city;
    } else if (!selectedTo && ap.iata !== selectedFrom.iata) {
        selectedTo = ap;
        document.getElementById('toInput').value = ap.city;
        checkBoarding();
    }
}

function checkBoarding() {
    if (selectedFrom && selectedTo) {
        document.getElementById('boardingBtn').disabled = false;
        drawFlightPath();
    }
}

// 2. Math & Physics Helpers
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getBearing(lat1, lng1, lat2, lng2) {
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const lat1R = lat1 * Math.PI / 180;
    const lat2R = lat2 * Math.PI / 180;
    const y = Math.sin(dLng) * Math.cos(lat2R);
    const x = Math.cos(lat1R) * Math.sin(lat2R) - Math.sin(lat1R) * Math.cos(lat2R) * Math.cos(dLng);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function drawFlightPath() {
    if (flightPath) map.removeLayer(flightPath);
    const latlngs = [[selectedFrom.lat, selectedFrom.lon], [selectedTo.lat, selectedTo.lon]];
    flightPath = L.polyline(latlngs, { color: '#fbbf24', weight: 2, dashArray: '10, 10' }).addTo(map);
    map.flyToBounds(flightPath.getBounds(), { padding: [50, 50] });
}

// 3. UI Interactions
document.getElementById("cameraLockBtn").onclick = function() {
    isCameraLocked = !isCameraLocked;
    this.innerText = isCameraLocked ? "CAMERA: LOCKED" : "CAMERA: FREE";
    this.classList.toggle("locked");
};

document.getElementById("boardingBtn").onclick = () => {
    document.getElementById("airplaneView").classList.remove("hidden");
    document.getElementById("routeDisplay").innerText = `${selectedFrom.iata} ✈ ${selectedTo.iata}`;
    const seatMap = document.getElementById("seatMap");
    seatMap.innerHTML = "";
    for (let i = 1; i <= 50; i++) {
        const rowNum = document.createElement("div");
        rowNum.style.color = "#64748b"; rowNum.innerText = i;
        seatMap.appendChild(rowNum);
        ["A", "GAP", "B", "C", "GAP", "D"].forEach(type => {
            if (type === "GAP") { seatMap.appendChild(document.createElement("div")); return; }
            const box = document.createElement("div");
            box.className = "seat-box";
            if (Math.random() < 0.25) box.classList.add("taken");
            else {
                box.onclick = () => {
                    document.querySelectorAll(".seat-box").forEach(s => s.classList.remove("selected"));
                    box.classList.add("selected");
                    document.getElementById("confirmSeatBtn").disabled = false;
                    document.getElementById("selectedSeatLabel").innerText = `Seat ${i}${type} Selected`;
                };
            }
            seatMap.appendChild(box);
        });
    }
};

// 4. Flight Execution
document.getElementById("confirmSeatBtn").onclick = () => {
    document.getElementById("airplaneView").classList.add("hidden");
    document.querySelector(".panel").classList.add("hidden");
    document.getElementById("flightTrackerUI").classList.remove("hidden");

    const start = [selectedFrom.lat, selectedFrom.lon];
    const end = [selectedTo.lat, selectedTo.lon];
    
    // Real-time duration (Distance / 850km/h cruise speed)
    const distance = getDistance(start[0], start[1], end[0], end[1]);
    const durationMS = (distance / 850) * 3600 * 1000;
    
    // Icon alignment (Bearing - 45deg for FontAwesome tilt)
    const angle = getBearing(start[0], start[1], end[0], end[1]);

    const planeIcon = L.divIcon({
        html: `<i class="fa-solid fa-plane" style="transform: rotate(${angle - 45}deg); color: #fbbf24; font-size: 32px; text-shadow: 0 0 10px rgba(0,0,0,0.5);"></i>`,
        className: 'plane-marker', iconSize: [32, 32], iconAnchor: [16, 16]
    });

    const marker = L.marker(start, { icon: planeIcon }).addTo(map);
    let startTime = performance.now();

    function animate(time) {
        let elapsed = time - startTime;
        let progress = Math.min(elapsed / durationMS, 1);
        
        const curLat = start[0] + (end[0] - start[0]) * progress;
        const curLon = start[1] + (end[1] - start[1]) * progress;
        marker.setLatLng([curLat, curLon]);

        if (isCameraLocked) {
            map.setView([curLat, curLon], map.getZoom(), { animate: false });
        }

        // Timer Update (HH:MM:SS)
        let remaining = Math.max(0, durationMS - elapsed);
        let s = Math.floor(remaining / 1000);
        let h = Math.floor(s / 3600);
        let m = Math.floor((s % 3600) / 60);
        s = s % 60;
        document.getElementById("timerDisplay").innerText = 
            `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
        
        if (progress < 1) requestAnimationFrame(animate);
        else { alert(`Welcome to ${selectedTo.city}!`); location.reload(); }
    }
    requestAnimationFrame(animate);
};

document.getElementById("backToMapBtn").onclick = () => document.getElementById("airplaneView").classList.add("hidden");
init();