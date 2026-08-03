/// Sessions is the SSH workspace, so repeating the protocol in every Lab tab
/// adds noise. Keep only endpoint information when it distinguishes multiple
/// interfaces on the same device.
export function labSshTabTitle(deviceName: string, endpointLabel?: string): string {
  const endpoint = endpointLabel?.trim();
  return endpoint ? `${deviceName} via ${endpoint}` : deviceName;
}
