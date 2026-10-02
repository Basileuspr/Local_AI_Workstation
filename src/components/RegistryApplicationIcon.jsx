import { useState } from "react";
import { automaticApplicationIcon, applicationInitials } from "../registryApplicationIcons";

export default function RegistryApplicationIcon({ application, customIcon }) {
  const source = customIcon || automaticApplicationIcon(application);
  const [failedSource, setFailedSource] = useState(null);
  return source && source !== failedSource
    ? <img className="registry-application-icon" src={source} alt="" aria-hidden="true" width={30} height={30}
        onError={() => setFailedSource(source)} />
    : <span className="registry-application-icon registry-application-initials" aria-hidden="true">{applicationInitials(application)}</span>;
}
