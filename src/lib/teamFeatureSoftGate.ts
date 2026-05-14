import { Alert } from "react-native";

type TeamFeatureSoftGateOptions = {
  onRegisterCompany?: () => void;
  onContinuePersonal?: () => void;
};

const SOFT_GATE_TITLE = "Tímová práca je dostupná v Staveto Business";
const SOFT_GATE_BODY =
  "Ak chcete pozývať ľudí, spravovať členov a používať tímové funkcie, zaregistrujte svoju firmu do Staveto Business.";
const REGISTER_LABEL = "Registrovať moju firmu";
const CONTINUE_LABEL = "Pokračovať v osobnom Stavete";

export function showTeamFeatureSoftGate(options: TeamFeatureSoftGateOptions = {}): void {
  Alert.alert(SOFT_GATE_TITLE, SOFT_GATE_BODY, [
    {
      text: REGISTER_LABEL,
      onPress: options.onRegisterCompany,
    },
    {
      text: CONTINUE_LABEL,
      style: "cancel",
      onPress: options.onContinuePersonal,
    },
  ]);
}

