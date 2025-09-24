declare global {
  interface Window {
    google: typeof google;
  }
}

declare namespace google {
  namespace maps {
    class Map {
      constructor(mapDiv: HTMLElement, opts?: any);
    }

    class LatLng {
      constructor(lat: number, lng: number);
      lat(): number;
      lng(): number;
    }

    class Geocoder {
      geocode(request: GeocoderRequest, callback: (results: GeocoderResult[] | null, status: GeocoderStatus) => void): void;
    }

    interface GeocoderRequest {
      address?: string;
      location?: LatLng;
    }

    interface GeocoderResult {
      formatted_address: string;
      geometry: {
        location: LatLng;
      };
      place_id: string;
      address_components: GeocoderAddressComponent[];
    }

    interface GeocoderAddressComponent {
      long_name: string;
      short_name: string;
      types: string[];
    }

    enum GeocoderStatus {
      OK = "OK",
      UNKNOWN_ERROR = "UNKNOWN_ERROR",
      OVER_QUERY_LIMIT = "OVER_QUERY_LIMIT",
      REQUEST_DENIED = "REQUEST_DENIED",
      INVALID_REQUEST = "INVALID_REQUEST",
      ZERO_RESULTS = "ZERO_RESULTS",
      ERROR = "ERROR"
    }

    class DirectionsService {
      route(request: DirectionsRequest, callback: (result: DirectionsResult | null, status: DirectionsStatus) => void): void;
    }

    interface DirectionsRequest {
      origin: LatLng;
      destination: LatLng;
      travelMode: TravelMode;
    }

    interface DirectionsResult {
      routes: DirectionsRoute[];
    }

    interface DirectionsRoute {
      legs: DirectionsLeg[];
      overview_polyline?: {
        points: string;
      };
    }

    interface DirectionsLeg {
      distance?: {
        value: number;
        text: string;
      };
      duration?: {
        value: number;
        text: string;
      };
    }

    enum DirectionsStatus {
      OK = "OK",
      NOT_FOUND = "NOT_FOUND",
      ZERO_RESULTS = "ZERO_RESULTS",
      MAX_WAYPOINTS_EXCEEDED = "MAX_WAYPOINTS_EXCEEDED",
      INVALID_REQUEST = "INVALID_REQUEST",
      OVER_QUERY_LIMIT = "OVER_QUERY_LIMIT",
      REQUEST_DENIED = "REQUEST_DENIED",
      UNKNOWN_ERROR = "UNKNOWN_ERROR"
    }

    enum TravelMode {
      DRIVING = "DRIVING",
      WALKING = "WALKING",
      BICYCLING = "BICYCLING",
      TRANSIT = "TRANSIT"
    }

    namespace places {
      class AutocompleteService {
        getPlacePredictions(request: AutocompletionRequest, callback: (results: AutocompletePrediction[] | null, status: PlacesServiceStatus) => void): void;
      }

      class PlacesService {
        constructor(attrContainer: HTMLElement | Map);
        getDetails(request: PlaceDetailsRequest, callback: (result: PlaceResult | null, status: PlacesServiceStatus) => void): void;
      }

      interface AutocompletionRequest {
        input: string;
        types?: string[];
        componentRestrictions?: {
          country: string | string[];
        };
      }

      interface AutocompletePrediction {
        place_id: string;
        description: string;
        structured_formatting: {
          main_text: string;
          secondary_text: string;
        };
      }

      interface PlaceDetailsRequest {
        placeId: string;
        fields: string[];
      }

      interface PlaceResult {
        address_components?: GeocoderAddressComponent[];
        formatted_address?: string;
        geometry?: {
          location?: LatLng;
        };
        place_id?: string;
      }

      enum PlacesServiceStatus {
        OK = "OK",
        UNKNOWN_ERROR = "UNKNOWN_ERROR",
        OVER_QUERY_LIMIT = "OVER_QUERY_LIMIT",
        REQUEST_DENIED = "REQUEST_DENIED",
        INVALID_REQUEST = "INVALID_REQUEST",
        ZERO_RESULTS = "ZERO_RESULTS",
        NOT_FOUND = "NOT_FOUND"
      }
    }
  }
}

export {};