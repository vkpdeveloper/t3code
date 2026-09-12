import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import * as OpenApi from "effect/unstable/httpapi/OpenApi";

import { RelayApi, RelayDeviceRegistrationRequest, RelayWebPushRegistrationRequest } from "./relay.ts";

const decodeDevice = Schema.decodeUnknownExit(RelayDeviceRegistrationRequest);
const device = {
  deviceId: "device",
  label: "Phone",
  pushToken: "token",
  preferences: {
    notificationsEnabled: true,
    liveActivitiesEnabled: true,
    notifyOnApproval: true,
    notifyOnInput: true,
    notifyOnCompletion: true,
    notifyOnFailure: true,
  },
};

describe("mobile device platforms", () => {
  it.each([
    [23, "Failure"],
    [24, "Success"],
    [37, "Success"],
  ])("enforces the Android minimum without an upper bound (API %i)", (androidApiLevel, result) => {
    expect(decodeDevice({ ...device, platform: "android", androidApiLevel })._tag).toBe(result);
  });

  it("accepts Android tokens without Apple routing and preserves older iOS registrations", () => {
    expect(decodeDevice({ ...device, platform: "android", androidApiLevel: 36 })._tag).toBe(
      "Success",
    );
    expect(decodeDevice({ ...device, platform: "ios", iosMajorVersion: 18 })._tag).toBe("Success");
  });
  it("rejects missing platform versions and Apple activity tokens on Android", () => {
    expect(decodeDevice({ ...device, platform: "ios" })._tag).toBe("Failure");
    expect(decodeDevice({ ...device, platform: "android" })._tag).toBe("Failure");
    expect(
      decodeDevice({
        ...device,
        platform: "android",
        androidApiLevel: 36,
        pushToStartToken: "apple-token",
      })._tag,
    ).toBe("Failure");
  });
});

describe("RelayApi security", () => {
  it("describes DPoP access tokens using the HTTP DPoP authorization scheme", () => {
    const document = OpenApi.fromApi(RelayApi);

    expect(document.components.securitySchemes?.relayDpop).toEqual({
      type: "http",
      scheme: "DPoP",
      description: "DPoP-bound access token. Requests must also include the DPoP proof JWT header.",
    });
  });
});

describe("RelayWebPushRegistrationRequest", () => {
  const decode = Schema.decodeUnknownSync(RelayWebPushRegistrationRequest);
  const registration = {
    subscriptionId: "subscription",
    label: "Web browser",
    subscription: {
      endpoint: "https://push.example.test/subscription",
      expirationTime: null,
      keys: { p256dh: "p256dh", auth: "auth" },
    },
    preferences: {
      notifyOnApproval: true,
      notifyOnInput: true,
      notifyOnCompletion: true,
      notifyOnFailure: true,
      soundEnabled: true,
    },
  };

  it("accepts secure standards-based push endpoints", () => {
    expect(decode(registration)).toEqual(registration);
  });

  it("defaults notifyOnInput for subscriptions registered before input alerts", () => {
    const { notifyOnInput: _ignored, ...legacyPreferences } = registration.preferences;
    expect(
      decode({
        ...registration,
        preferences: legacyPreferences,
      }).preferences.notifyOnInput,
    ).toBe(true);
  });

  it("rejects insecure or malformed push endpoints", () => {
    expect(() =>
      decode({
        ...registration,
        subscription: { ...registration.subscription, endpoint: "http://localhost/push" },
      }),
    ).toThrow();
    expect(() =>
      decode({
        ...registration,
        subscription: { ...registration.subscription, endpoint: "not a URL" },
      }),
    ).toThrow();
  });
});
