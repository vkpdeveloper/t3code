package expo.modules.t3agentstatus

import android.app.ForegroundServiceStartNotAllowedException
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class AgentStatusRow : Record {
  @Field var threadKey: String = ""
  @Field var environmentLabel: String = ""
  @Field var projectTitle: String = ""
  @Field var threadTitle: String = ""
  @Field var phase: String = "running"
  @Field var phaseLabel: String = ""
  @Field var deepLink: String = ""
  @Field var startedAtMs: Double? = null
}

class AgentStatusTheme : Record {
  @Field var accentColor: String = "#262626"
  @Field var backgroundColor: String = "#f2f2f7"
  @Field var foregroundColor: String = "#262626"
}

class AgentStatusSummary : Record {
  @Field var rows: List<AgentStatusRow> = emptyList()
  @Field var onlineCount: Int = 0
  @Field var totalCount: Int = 0
  @Field var theme: AgentStatusTheme = AgentStatusTheme()
  @Field var launchUrlScheme: String = ""
}

/**
 * JS-facing surface for the Android status notification. The module only
 * forwards summaries to [T3AgentStatusService]; the service owns the
 * foreground lifecycle and the notification it displays.
 */
class T3AgentStatusModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("T3AgentStatus")

    Function("canPostPromotedNotifications") {
      val manager = requireContext().getSystemService(NotificationManager::class.java)
      AgentStatusNotifications.canPostPromoted(manager)
    }

    Function("ensureChannels") {
      AgentStatusNotifications.ensureChannels(requireContext())
    }

    // Starts or updates the foreground service with the given summary.
    // Returns false when Android refused to start it (the app was in the
    // background with no running service), so JS can retry on foreground.
    Function("update") { summary: AgentStatusSummary ->
      val context = requireContext()
      val intent = T3AgentStatusService.updateIntent(context, summary)
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          context.startForegroundService(intent)
        } else {
          context.startService(intent)
        }
        true
      } catch (error: IllegalStateException) {
        // ForegroundServiceStartNotAllowedException extends this on API 31+.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
          error is ForegroundServiceStartNotAllowedException
        ) {
          false
        } else {
          throw error
        }
      }
    }

    Function("stop") {
      val context = requireContext()
      context.stopService(Intent(context, T3AgentStatusService::class.java))
    }
  }

  private fun requireContext(): Context =
    appContext.reactContext ?: throw IllegalStateException("React context is not available")
}
