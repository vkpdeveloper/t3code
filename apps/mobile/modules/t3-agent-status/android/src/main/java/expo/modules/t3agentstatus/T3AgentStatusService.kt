package expo.modules.t3agentstatus

import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import java.util.concurrent.CopyOnWriteArraySet

/**
 * Foreground service that keeps the React Native process, and with it every
 * environment WebSocket, alive while the status notification is enabled.
 *
 * It is a [HeadlessJsTaskService] on purpose: React Native stops firing JS
 * timers once the activity is paused unless a headless task is active, which
 * would stall reconnect backoff and the client activity lease. The service
 * runs one never-finishing keep-alive task so timers keep ticking, and ends
 * it when the service stops.
 *
 * Start and update share one intent shape. The notification itself is built
 * by [AgentStatusNotifications].
 */
class T3AgentStatusService : HeadlessJsTaskService() {
  private val keepAliveTaskIds: MutableSet<Int> = CopyOnWriteArraySet()

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val summary = intent?.let(::summaryFromIntent)
    if (summary == null) {
      stopSelf()
      return START_NOT_STICKY
    }
    AgentStatusNotifications.ensureChannels(this)
    val notification = AgentStatusNotifications.build(this, summary)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(
        AgentStatusNotifications.STATUS_NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
      )
    } else {
      startForeground(AgentStatusNotifications.STATUS_NOTIFICATION_ID, notification)
    }
    if (keepAliveTaskIds.isEmpty()) {
      startTask(
        HeadlessJsTaskConfig(
          KEEP_ALIVE_TASK_KEY,
          Arguments.createMap(),
          0,
          true,
        ),
      )
    }
    // Not sticky: without the JS side there is nothing to show, and a restart
    // would put up a stale list with no one to update it.
    return START_NOT_STICKY
  }

  override fun onHeadlessJsTaskStart(taskId: Int) {
    keepAliveTaskIds.add(taskId)
  }

  override fun onHeadlessJsTaskFinish(taskId: Int) {
    keepAliveTaskIds.remove(taskId)
    super.onHeadlessJsTaskFinish(taskId)
  }

  override fun onDestroy() {
    // Release the keep-alive so JS timers pause again once the notification
    // is gone; the base class then drops the listener and the wake lock.
    reactContext?.let { context ->
      val taskContext = HeadlessJsTaskContext.getInstance(context)
      for (taskId in keepAliveTaskIds) {
        taskContext.finishTask(taskId)
      }
    }
    keepAliveTaskIds.clear()
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  companion object {
    /** Registered from JS with AppRegistry.registerHeadlessTask; resolves never. */
    const val KEEP_ALIVE_TASK_KEY = "T3AgentStatusKeepAlive"

    private const val EXTRA_LAUNCH_SCHEME = "launchUrlScheme"
    private const val EXTRA_ONLINE_COUNT = "onlineCount"
    private const val EXTRA_TOTAL_COUNT = "totalCount"
    private const val EXTRA_ACCENT_COLOR = "accentColor"
    private const val EXTRA_BACKGROUND_COLOR = "backgroundColor"
    private const val EXTRA_FOREGROUND_COLOR = "foregroundColor"
    private const val EXTRA_ROW_COUNT = "rowCount"
    private const val EXTRA_ROW_PREFIX = "row."

    fun updateIntent(context: Context, summary: AgentStatusSummary): Intent =
      Intent(context, T3AgentStatusService::class.java).apply {
        putExtra(EXTRA_LAUNCH_SCHEME, summary.launchUrlScheme)
        putExtra(EXTRA_ONLINE_COUNT, summary.onlineCount)
        putExtra(EXTRA_TOTAL_COUNT, summary.totalCount)
        putExtra(EXTRA_ACCENT_COLOR, summary.theme.accentColor)
        putExtra(EXTRA_BACKGROUND_COLOR, summary.theme.backgroundColor)
        putExtra(EXTRA_FOREGROUND_COLOR, summary.theme.foregroundColor)
        putExtra(EXTRA_ROW_COUNT, summary.rows.size)
        summary.rows.forEachIndexed { index, row ->
          val prefix = "$EXTRA_ROW_PREFIX$index."
          putExtra("${prefix}threadKey", row.threadKey)
          putExtra("${prefix}environmentLabel", row.environmentLabel)
          putExtra("${prefix}projectTitle", row.projectTitle)
          putExtra("${prefix}threadTitle", row.threadTitle)
          putExtra("${prefix}phase", row.phase)
          putExtra("${prefix}phaseLabel", row.phaseLabel)
          putExtra("${prefix}deepLink", row.deepLink)
          row.startedAtMs?.let { putExtra("${prefix}startedAtMs", it) }
        }
      }

    private fun summaryFromIntent(intent: Intent): AgentStatusSummary {
      val count = intent.getIntExtra(EXTRA_ROW_COUNT, 0)
      val rows = (0 until count).map { index ->
        val prefix = "$EXTRA_ROW_PREFIX$index."
        AgentStatusRow().apply {
          threadKey = intent.getStringExtra("${prefix}threadKey") ?: ""
          environmentLabel = intent.getStringExtra("${prefix}environmentLabel") ?: ""
          projectTitle = intent.getStringExtra("${prefix}projectTitle") ?: ""
          threadTitle = intent.getStringExtra("${prefix}threadTitle") ?: ""
          phase = intent.getStringExtra("${prefix}phase") ?: "running"
          phaseLabel = intent.getStringExtra("${prefix}phaseLabel") ?: ""
          deepLink = intent.getStringExtra("${prefix}deepLink") ?: ""
          startedAtMs =
            if (intent.hasExtra("${prefix}startedAtMs")) {
              intent.getDoubleExtra("${prefix}startedAtMs", 0.0)
            } else {
              null
            }
        }
      }
      return AgentStatusSummary().apply {
        this.rows = rows
        onlineCount = intent.getIntExtra(EXTRA_ONLINE_COUNT, 0)
        totalCount = intent.getIntExtra(EXTRA_TOTAL_COUNT, 0)
        theme = AgentStatusTheme().apply {
          accentColor = intent.getStringExtra(EXTRA_ACCENT_COLOR) ?: "#262626"
          backgroundColor = intent.getStringExtra(EXTRA_BACKGROUND_COLOR) ?: "#f2f2f7"
          foregroundColor = intent.getStringExtra(EXTRA_FOREGROUND_COLOR) ?: "#262626"
        }
        launchUrlScheme = intent.getStringExtra(EXTRA_LAUNCH_SCHEME) ?: ""
      }
    }
  }
}
