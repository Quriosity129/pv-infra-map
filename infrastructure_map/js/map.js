// Initialize the map
const map = L.map('map').setView([33.9798, -118.0715], 8.79);

// Create base layers
const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
    maxZoom: 20
});

// Add Anaheim boundary
fetch('data/anaheim.geojson')
    .then(response => response.json())
    .then(data => {
        L.geoJSON(data, {
            style: {
                color: '#4a4a4a',
                weight: 6,
                opacity: 1.0,
                fillColor: 'none',
            }
        }).addTo(map);
    })
    .catch(error => console.error('Error loading Anaheim boundary:', error));

// Layer groups for different infrastructure types
const powerLinesLayer = L.layerGroup().addTo(map);
const minorLinesLayer = L.layerGroup().addTo(map);
const substationsLayer = L.layerGroup().addTo(map);
const pvLocationsLayer = L.layerGroup().addTo(map);
const serviceAreasLayer = L.layerGroup();
const highlightedPVLayer = L.layerGroup();

let currentServiceArea = null;
let currentHighlightedPVs = null;

// Base layer switching
document.querySelectorAll('input[name="base-layer"]').forEach(input => {
    input.addEventListener('change', function(e) {
        if (e.target.value === 'osm') {
            map.removeLayer(satelliteLayer);
            map.addLayer(osmLayer);
        } else {
            map.removeLayer(osmLayer);
            map.addLayer(satelliteLayer);
        }
    });
});

// Function to load and display infrastructure data
async function loadInfrastructureData() {
    try {
        // Load all data in parallel
        const [
            powerLinesResponse,
            minorLinesResponse,
            substationsResponse,
            pvLocationsResponse,
            serviceAreasResponse
        ] = await Promise.all([
            fetch('data/power_lines.geojson'),
            fetch('data/minor_lines.geojson'),
            fetch('data/substations_merged.geojson'),
            fetch('data/pv_locations.geojson'),
            fetch('data/service_areas.geojson')
        ]);

        const powerLinesData = await powerLinesResponse.json();
        const minorLinesData = await minorLinesResponse.json();
        const substationsData = await substationsResponse.json();
        const pvLocationsData = await pvLocationsResponse.json();
        const serviceAreasData = await serviceAreasResponse.json();

        // Add power lines to map
        L.geoJSON(powerLinesData, {
            style: {
                color: '#ff0000',
                weight: 3,
                opacity: 0.8
            },
            onEachFeature: function(feature, layer) {
                if (feature.properties) {
                    layer.bindPopup(`
                        <strong>Major Power Line</strong><br>
                        ${Object.entries(feature.properties)
                            .map(([key, value]) => `${key}: ${value}`)
                            .join('<br>')}
                    `);
                }
            }
        }).addTo(powerLinesLayer);

        // Add minor power lines to map
        L.geoJSON(minorLinesData, {
            style: {
                color: '#008000',  // Green color for better visibility on satellite imagery
                weight: 2,
                opacity: 0.8
            },
            onEachFeature: function(feature, layer) {
                if (feature.properties) {
                    layer.bindPopup(`
                        <strong>Minor Power Line</strong><br>
                        ${Object.entries(feature.properties)
                            .map(([key, value]) => `${key}: ${value}`)
                            .join('<br>')}
                    `);
                }
            }
        }).addTo(minorLinesLayer);

        // Store service areas and PV locations by substation ID for quick access
        const serviceAreasBySubstation = {};
        const pvLocationsBySubstation = {};
        
        serviceAreasData.features.forEach(feature => {
            serviceAreasBySubstation[feature.properties.substation_id] = feature;
        });
        
        pvLocationsData.features.forEach(feature => {
            const substationId = feature.properties.substation_id;
            if (!pvLocationsBySubstation[substationId]) {
                pvLocationsBySubstation[substationId] = [];
            }
            pvLocationsBySubstation[substationId].push(feature);
        });

        // Add substations to map with click handler
        L.geoJSON(substationsData, {
            pointToLayer: function(feature, latlng) {
                return L.circleMarker(latlng, {
                    radius: 8,
                    fillColor: '#0000ff',
                    color: '#000',
                    weight: 1,
                    opacity: 1,
                    fillOpacity: 0.8
                });
            },
            onEachFeature: function(feature, layer) {
                if (feature.properties) {
                    // Basic popup
                    layer.bindPopup(`
                        <strong>Substation</strong><br>
                        ${Object.entries(feature.properties)
                            .map(([key, value]) => `${key}: ${value}`)
                            .join('<br>')}
                    `);

                    // Click handler for service area
                    layer.on('click', function(e) {
                        const substationId = feature.properties.id || feature.properties.osm_id;
                        const serviceArea = serviceAreasBySubstation[substationId];
                        const associatedPVs = pvLocationsBySubstation[substationId] || [];
                        
                        // Clear previous highlights
                        serviceAreasLayer.clearLayers();
                        highlightedPVLayer.clearLayers();
                        
                        if (serviceArea) {
                            // Show service area
                            currentServiceArea = L.geoJSON(serviceArea, {
                                style: {
                                    color: '#ff7800',
                                    weight: 2,
                                    opacity: 0.65,
                                    fillOpacity: 0.2
                                }
                            }).addTo(serviceAreasLayer);

                            // Calculate total PV installed power
                            const totalPower = associatedPVs.reduce((sum, pv) => sum + pv.properties.power_kW, 0);
                            
                            // Add popup to service area
                            currentServiceArea.bindPopup(`
                                <strong>Service Area</strong><br>
                                Substation ID: ${substationId}<br>
                                Number of PV installations: ${associatedPVs.length}<br>
                                Total PV installed power: ${totalPower.toFixed(1)} kW
                            `).openPopup();

                            // Highlight associated PV installations
                            L.geoJSON({
                                type: "FeatureCollection",
                                features: associatedPVs
                            }, {
                                pointToLayer: function(feature, latlng) {
                                    return L.circleMarker(latlng, {
                                        radius: Math.min(Math.sqrt(feature.properties.area_pv) / 2, 10),
                                        fillColor: '#ff7800',  // Same color as service area
                                        color: '#000',
                                        weight: 1,
                                        opacity: 1,
                                        fillOpacity: 0.8
                                    });
                                }
                            }).addTo(highlightedPVLayer);
                        }
                        
                        // Add layers to map
                        if (!map.hasLayer(serviceAreasLayer)) {
                            map.addLayer(serviceAreasLayer);
                        }
                        if (!map.hasLayer(highlightedPVLayer)) {
                            map.addLayer(highlightedPVLayer);
                        }
                    });
                }
            }
        }).addTo(substationsLayer);

        // Add PV locations to map
        L.geoJSON(pvLocationsData, {
            pointToLayer: function(feature, latlng) {
                return L.circleMarker(latlng, {
                    radius: Math.min(Math.sqrt(feature.properties.power_kW) / 2, 10),  // Scale radius by area, max 10
                    fillColor: '#ffff00',
                    color: '#000',
                    weight: 1,
                    opacity: 1,
                    fillOpacity: 0.8
                });
            },
            onEachFeature: function(feature, layer) {
                if (feature.properties) {
                    layer.bindPopup(`
                        <strong>PV Installation</strong><br>
                        Power: ${feature.properties.power_kW} kW<br>
                        Address: ${feature.properties.address}<br>
                        Substation ID: ${feature.properties.substation_id}
                    `);
                }
            }
        }).addTo(pvLocationsLayer);

    } catch (error) {
        console.error('Error loading infrastructure data:', error);
    }
}

// Layer control event listeners
document.getElementById('power-lines').addEventListener('change', function(e) {
    if (e.target.checked) {
        map.addLayer(powerLinesLayer);
    } else {
        map.removeLayer(powerLinesLayer);
    }
});

document.getElementById('minor-lines').addEventListener('change', function(e) {
    if (e.target.checked) {
        map.addLayer(minorLinesLayer);
    } else {
        map.removeLayer(minorLinesLayer);
    }
});

document.getElementById('substations').addEventListener('change', function(e) {
    if (e.target.checked) {
        map.addLayer(substationsLayer);
    } else {
        map.removeLayer(substationsLayer);
    }
});

document.getElementById('pv-locations').addEventListener('change', function(e) {
    if (e.target.checked) {
        map.addLayer(pvLocationsLayer);
    } else {
        map.removeLayer(pvLocationsLayer);
    }
});

// Add click handler to map to clear highlights
map.on('click', function(e) {
    // Only clear if we didn't click on a substation
    if (!e.originalEvent.defaultPrevented) {
        serviceAreasLayer.clearLayers();
        highlightedPVLayer.clearLayers();
        currentServiceArea = null;
    }
});

// Load the infrastructure data when the page loads
loadInfrastructureData(); 