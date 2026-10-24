import type { StyleSpecification } from 'maplibre-gl';
import { MapStyleId } from '../types/gpx';

export interface MapStyleOption {
  id: MapStyleId;
  label: string;
  description: string;
  style: StyleSpecification;
}

function createRasterStyle(
  name: string,
  tiles: string[],
  attribution: string,
  maxzoom = 19,
  bgColor = '#0f172a',
  overlayTiles?: string[]
): StyleSpecification {
  const sources: StyleSpecification['sources'] = {
    'raster-tiles': {
      type: 'raster',
      tiles,
      tileSize: 256,
      maxzoom,
      attribution,
    },
  };

  const layers: StyleSpecification['layers'] = [
    {
      id: 'background',
      type: 'background',
      paint: {
        'background-color': bgColor,
      },
    },
    {
      id: 'simple-tiles',
      type: 'raster',
      source: 'raster-tiles',
      minzoom: 0,
      maxzoom: 22,
    },
  ];

  if (overlayTiles && overlayTiles.length > 0) {
    sources['raster-overlay'] = {
      type: 'raster',
      tiles: overlayTiles,
      tileSize: 256,
      maxzoom,
    };
    layers.push({
      id: 'overlay-tiles',
      type: 'raster',
      source: 'raster-overlay',
      minzoom: 0,
      maxzoom: 22,
    });
  }

  return {
    version: 8,
    name,
    sources,
    layers,
  };
}

export const MAP_STYLE_OPTIONS: Record<MapStyleId, MapStyleOption> = {
  dark: {
    id: 'dark',
    label: 'Dark Pro',
    description: 'High-contrast dark map (Watermark-free, no API key required)',
    style: createRasterStyle(
      'Esri Dark Gray Canvas',
      [
        'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
      ],
      '© Esri, HERE, Garmin, OpenStreetMap contributors',
      16,
      '#090d16',
      [
        'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
      ]
    ),
  },
  topo: {
    id: 'topo',
    label: 'Topo Terrain',
    description: 'Contour lines and mountain terrain shading (No API key required)',
    style: createRasterStyle(
      'World Topo Map',
      [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
      ],
      '© Esri, HERE, Garmin, OpenStreetMap contributors',
      19,
      '#e2e8f0'
    ),
  },
  satellite: {
    id: 'satellite',
    label: 'Satellite Aerial',
    description: 'High-resolution aerial imagery (No API key required)',
    style: createRasterStyle(
      'Esri World Imagery',
      [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      '© Esri, Maxar, Earthstar Geographics',
      19,
      '#051014',
      [
        'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      ]
    ),
  },
  street: {
    id: 'street',
    label: 'Clean Street (Esri)',
    description: 'Detailed street map with roads and landmarks (No API key required)',
    style: createRasterStyle(
      'Esri World Street Map',
      [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
      ],
      '© Esri, HERE, Garmin, USGS, OpenStreetMap contributors',
      19,
      '#f8fafc'
    ),
  },
};
