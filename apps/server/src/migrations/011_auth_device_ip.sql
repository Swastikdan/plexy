-- Remember the last socket-reported address for each authenticated device.
ALTER TABLE auth_devices ADD COLUMN last_ip TEXT;
