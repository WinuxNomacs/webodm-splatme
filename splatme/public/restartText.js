// What SplatMe says while WebODM's worker does not hear of completed tasks (the status' or automation's
// "listening" is false): WebODM has not been restarted since SplatMe was installed or updated
export const NOT_LISTENING = "Tasks are not trained by themselves until WebODM is restarted once after SplatMe was installed or updated (an administrator runs ./webodm.sh restart). Until then, train them with Train Splats.";
