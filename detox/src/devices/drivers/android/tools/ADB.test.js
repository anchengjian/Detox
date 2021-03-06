describe('ADB', () => {
  const adbBinPath = `/Android/sdk-mock/platform-tools/adb`;

  let mockEmulatorTelnet;
  let ADB;
  let adb;
  let exec;

  beforeEach(() => {
    jest.mock('../../../../utils/logger');
    jest.mock('../../../../utils/environment');
    require('../../../../utils/environment').getAdbPath.mockReturnValue(adbBinPath);

    jest.mock('../../../../utils/encoding', () => ({
      encodeBase64: (text) => `base64(${text})`,
    }));

    mockEmulatorTelnet = {
      connect: jest.fn(),
      quit: jest.fn(),
      avdName: jest.fn(),
    };
    class MockEmulatorTelnet {
      constructor() {
        this.connect = mockEmulatorTelnet.connect;
        this.quit = mockEmulatorTelnet.quit;
        this.avdName = mockEmulatorTelnet.avdName;
      }
    }
    jest.mock('./EmulatorTelnet', () => MockEmulatorTelnet);

    jest.mock('../../../../utils/exec', () => {
      const exec = jest.fn();
      exec.mockReturnValue({ stdout: '' });
      return { execWithRetriesAndLogs: exec };
    });
    exec = require('../../../../utils/exec').execWithRetriesAndLogs;

    ADB = require('./ADB');
    adb = new ADB();
  });

  describe('devices', () => {
    it(`should invoke ADB`, async () => {
      await adb.devices();
      expect(exec).toHaveBeenCalledWith(`"${adbBinPath}"  devices`, { verbosity: 'high' }, undefined, 1);
      expect(exec).toHaveBeenCalledTimes(1);
    });

    it('should query device name lazily', async () => {
      const adbDevices = 'List of devices attached\n'
        + 'MOCK_SERIAL\tdevice\n'
        + '192.168.60.101:6666\tdevice\n'
        + 'emulator-5554\tdevice\n'
        + 'emulator-5556\toffline\n'
        + '\n';


      exec.mockReturnValue({ stdout: adbDevices });

      const { devices, stdout } = await adb.devices();
      expect(stdout).toBe(adbDevices);
      expect(devices).toHaveLength(4);

      expect(devices).toEqual([
        { type: 'device', adbName: 'MOCK_SERIAL', status: 'device' },
        { type: 'genymotion', adbName: '192.168.60.101:6666', status: 'device' },
        { type: 'emulator', adbName: 'emulator-5554', port: '5554', status: 'device' },
        { type: 'emulator', adbName: 'emulator-5556', port: '5556', status: 'offline' },
      ]);

      mockEmulatorTelnet.avdName.mockReturnValue('Nexus_5X_API_29_x86');
      expect(await devices[2].queryName()).toBe('Nexus_5X_API_29_x86');
      expect(mockEmulatorTelnet.connect).toHaveBeenCalledWith('5554');
    });

    it(`Parse 'adb device' output with devices of all kinds`, async () => {
      const adbDevicesConsoleOutput = "List of devices attached\n"
        + "192.168.60.101:5555\tdevice\n"
        + "emulator-5556\tdevice\n"
        + "emulator-5554\tdevice\n"
        + "sx432wsds\tdevice\n"
        + "\n";
      exec.mockReturnValue({
        stdout: adbDevicesConsoleOutput
      });

      const { devices } = await adb.devices();
      expect(devices).toEqual([
        { "adbName": "192.168.60.101:5555", "type": "genymotion", status: "device" },
        { "adbName": "emulator-5556", "port": "5556", "type": "emulator", status: "device" },
        { "adbName": "emulator-5554", "port": "5554", "type": "emulator", status: "device" },
        { "adbName": "sx432wsds", "type": "device", status: "device" }
      ]);
    });

    it(`should return an empty list if no devices are available`, async () => {
      exec.mockReturnValue({
        stdout: 'List of devices attached\n'
      });

      const {devices} = await adb.devices();
      expect(devices.length).toEqual(0);
    });

    it(`should abort if port can't be parsed`, async () => {
      const adbDevicesResult = 'List of devices attached\nemulator-\tdevice\n';
      exec.mockReturnValue({
        stdout: adbDevicesResult
      });

      try {
        await adb.devices();
        fail('Expected an error');
      } catch (error) {
        expect(mockEmulatorTelnet.connect).not.toHaveBeenCalled();
        expect(error.message).toContain(`Failed to determine telnet port for emulator device 'emulator-'!`);
        expect(error.message).toContain(`base64(${adbDevicesResult})`);
      }
    });

    it(`should skip telnet if no devices are available`, async () => {
      exec.mockReturnValue({
        stdout: 'List of devices attached\n'
      });

      await adb.devices();
      expect(mockEmulatorTelnet.connect).not.toHaveBeenCalled();
    });
  });

  it(`install`, async () => {
    await adb.install('emulator-5556', 'path inside "quotes" to/app');

    expect(exec).toHaveBeenCalledWith(
      expect.stringContaining('adb" -s emulator-5556 shell "getprop ro.build.version.sdk"'),
      {}, undefined, 5);

    expect(exec).toHaveBeenCalledWith(
      expect.stringContaining('adb" -s emulator-5556 install -rg "path inside \\"quotes\\" to/app"'),
      undefined, undefined, 1);
  });

  it(`uninstall`, async () => {
    await adb.uninstall('com.package');
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it(`terminate`, async () => {
    await adb.terminate('com.package');
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it(`pidof (success)`, async () => {
    jest.spyOn(adb, 'shell').mockImplementation(async () =>
      `u0_a19        2199  1701 3554600  70264 0                   0 s com.google.android.ext.services `);

    expect(await adb.pidof('', 'com.google.android.ext.services')).toBe(2199);
  });

  it(`pidof (failure)`, async () => {
    jest.spyOn(adb, 'shell').mockImplementation(async () => '');
    expect(await adb.pidof('', 'com.google.android.ext.services')).toBe(NaN);
  });

  it('push', async () => {
    const deviceId = 'mockEmulator';
    const sourceFile = '/mock-source/file.xyz';
    const destFile = '/sdcard/file.abc';
    await adb.push(deviceId, sourceFile, destFile);

    expect(exec).toHaveBeenCalledWith(
      expect.stringContaining(`-s mockEmulator push "${sourceFile}" "${destFile}"`),
      undefined, undefined, expect.anything());
  });

  it('remote-install', async () => {
    const deviceId = 'mockEmulator';
    const binaryPath = '/mock-path/filename.mock';
    await adb.remoteInstall(deviceId, binaryPath);

    expect(exec).toHaveBeenCalledWith(
      expect.stringContaining(`-s mockEmulator shell "pm install -r -g -t ${binaryPath}"`),
      undefined, undefined, expect.anything());
  });

  describe('unlockScreen', () => {
    const deviceId = 'mockEmulator';

    async function unlockScreenWithPowerStatus(mWakefulness, mUserActivityTimeoutOverrideFromWindowManager) {
      jest.spyOn(adb, 'shell').mockImplementation(async () => `
        mWakefulness=${mWakefulness}
        mWakefulnessChanging=false
        mWakeLockSummary=0x0
        mUserActivitySummary=0x1
        mWakeUpWhenPluggedOrUnpluggedConfig=false
        mWakeUpWhenPluggedOrUnpluggedInTheaterModeConfig=false
        mUserActivityTimeoutOverrideFromWindowManager=${mUserActivityTimeoutOverrideFromWindowManager}
        mUserInactiveOverrideFromWindowManager=false
      `);

      await adb.unlockScreen(deviceId);
    }

    describe('when unlocking an awake and unlocked device', function() {
      beforeEach(async () => unlockScreenWithPowerStatus('Awake', '-1'));

      it('should not press power button', () =>
        expect(adb.shell).not.toHaveBeenCalledWith(deviceId, 'input keyevent KEYCODE_POWER'));

      it('should not press menu button', () =>
        expect(adb.shell).not.toHaveBeenCalledWith(deviceId, 'input keyevent KEYCODE_MENU'));
    });

    describe('when unlocking a sleeping and locked device', function() {
      beforeEach(async () => unlockScreenWithPowerStatus('Asleep', '10000'));

      it('should press power button first', () =>
        expect(adb.shell.mock.calls[1]).toEqual([deviceId, 'input keyevent KEYCODE_POWER']));

      it('should press menu afterwards', () =>
        expect(adb.shell.mock.calls[2]).toEqual([deviceId, 'input keyevent KEYCODE_MENU']));
    });

    describe('when unlocking an awake but locked device', function() {
      beforeEach(async () => unlockScreenWithPowerStatus('Awake', '10000'));

      it('should not press power button', () =>
        expect(adb.shell).not.toHaveBeenCalledWith(deviceId, 'input keyevent KEYCODE_POWER'));

      it('should press menu button', () =>
        expect(adb.shell).toHaveBeenCalledWith(deviceId, 'input keyevent KEYCODE_MENU'));
    });

    describe('when unlocking a sleeping but unlocked device', function() {
      beforeEach(async () => unlockScreenWithPowerStatus('Asleep', '-1'));

      it('should press power button', () =>
        expect(adb.shell).toHaveBeenCalledWith(deviceId, 'input keyevent KEYCODE_POWER'));

      it('should not press menu button', () =>
        expect(adb.shell).not.toHaveBeenCalledWith(deviceId, 'input keyevent KEYCODE_MENU'));
    });
  });

  it(`listInstrumentation passes the right deviceId`, async () => {
    const deviceId = 'aDeviceId';
    jest.spyOn(adb, 'shell');

    await adb.listInstrumentation(deviceId);

    expect(adb.shell).toBeCalledWith(deviceId, 'pm list instrumentation');
  });

  it(`getInstrumentationRunner parses the correct runner for the package`, async () => {
    const expectedRunner = "com.example.android.apis/.app.LocalSampleInstrumentation";
    const expectedPackage = "com.example.android.apis";
    const instrumentationRunnersShellOutput =
      "instrumentation:com.android.emulator.smoketests/android.support.test.runner.AndroidJUnitRunner (target=com.android.emulator.smoketests)\n" +
      "instrumentation:com.android.smoketest.tests/com.android.smoketest.SmokeTestRunner (target=com.android.smoketest)\n" +
      `instrumentation:${expectedRunner} (target=${expectedPackage})\n` +
      "instrumentation:org.chromium.webview_shell/.WebViewLayoutTestRunner (target=org.chromium.webview_shell)\n";

    jest.spyOn(adb, 'shell').mockImplementation(async () => instrumentationRunnersShellOutput);

    const result = await adb.getInstrumentationRunner('aDeviceId', expectedPackage);

    expect(adb.shell).toBeCalledWith('aDeviceId', 'pm list instrumentation');
    expect(result).toEqual(expectedRunner);
  });
});
