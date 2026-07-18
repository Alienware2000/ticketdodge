"use client";

import { useEffect } from "react";
import {
  CircleMarker,
  MapContainer,
  Marker,
  TileLayer,
  Tooltip,
  ZoomControl,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { divIcon } from "leaflet";

type Location = {
  lat: number;
  lng: number;
};

type TicketMapProps = {
  location: Location;
  userLocation: Location | null;
  selectedStreet: string;
  scoreColor: string;
  onLocationSelect: (location: Location) => void;
};

const FLATIRON: [number, number] = [40.7411, -73.9897];

const userLocationIcon = divIcon({
  className: "user-location-marker",
  html: '<span class="user-location-pulse"></span><span class="user-location-dot"></span>',
  iconAnchor: [12, 12],
  iconSize: [24, 24],
});

function MapClickHandler({
  onLocationSelect,
}: Pick<TicketMapProps, "onLocationSelect">) {
  useMapEvents({
    click(event) {
      onLocationSelect({ lat: event.latlng.lat, lng: event.latlng.lng });
    },
  });

  return null;
}

function FollowSelection({ location }: { location: Location }) {
  const map = useMap();

  useEffect(() => {
    map.flyTo([location.lat, location.lng], Math.max(map.getZoom(), 16), {
      duration: 0.55,
    });
  }, [location, map]);

  return null;
}

export default function TicketMap({
  location,
  userLocation,
  selectedStreet,
  scoreColor,
  onLocationSelect,
}: TicketMapProps) {
  return (
    <MapContainer
      center={FLATIRON}
      zoom={16}
      zoomControl={false}
      minZoom={13}
      className="h-full w-full"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ZoomControl position="bottomleft" />
      <MapClickHandler onLocationSelect={onLocationSelect} />
      <FollowSelection location={location} />
      {userLocation ? (
        <Marker position={[userLocation.lat, userLocation.lng]} icon={userLocationIcon}>
          <Tooltip permanent direction="top" offset={[0, -12]} className="you-label">
            You are here
          </Tooltip>
        </Marker>
      ) : null}
      <CircleMarker
        center={[location.lat, location.lng]}
        radius={12}
        pathOptions={{
          color: "#ffffff",
          fillColor: scoreColor,
          fillOpacity: 1,
          opacity: 1,
          weight: 4,
        }}
      >
        <Tooltip permanent direction="top" offset={[0, -11]} className="ticket-label">
          {selectedStreet}
        </Tooltip>
      </CircleMarker>
    </MapContainer>
  );
}
