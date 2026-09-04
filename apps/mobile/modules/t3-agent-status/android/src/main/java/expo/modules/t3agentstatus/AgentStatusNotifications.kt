package expo.modules.t3agentstatus

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.SystemClock
import android.view.View
import android.widget.RemoteViews
import androidx.core.app.NotificationCompat
import kotlin.math.roundToInt

/** Builds the single ongoing notification that summarizes active agent tasks. */
object AgentStatusNotifications {
  const val STATUS_CHANNEL_ID = "t3code.agent-status"
  const val ALERT_CHANNEL_ID = "t3code.agent-alerts"
  const val STATUS_NOTIFICATION_ID = 0x7301

  /** Promoted ongoing notifications and ProgressStyle require Android 16 QPR1. */
  const val PROMOTED_NOTIFICATIONS_SDK = 36

  private const val MAX_LISTED_ROWS = 6
  private const val MAX_CHIP_LENGTH = 7
  private const val APPROVAL_COLOR = "#f59e0b"
  private const val INPUT_COLOR = "#3b82f6"

  fun ensureChannels(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java)
    val status = NotificationChannel(
      STATUS_CHANNEL_ID,
      "Agent status",
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = "Ongoing summary of coding agents working across your machines."
      setShowBadge(false)
      enableVibration(false)
      setSound(null, null)
    }
    val alerts = NotificationChannel(
      ALERT_CHANNEL_ID,
      "Agent alerts",
      NotificationManager.IMPORTANCE_DEFAULT,
    ).apply {
      description = "An agent finished, failed, or needs your approval or input."
    }
    manager.createNotificationChannel(status)
    manager.createNotificationChannel(alerts)
  }

  fun canPostPromoted(manager: NotificationManager): Boolean {
    if (Build.VERSION.SDK_INT < PROMOTED_NOTIFICATIONS_SDK) return false
    // Reflection keeps the module compatible with API 36 SDKs that predate
    // the QPR1 method while still calling NotificationManager at runtime.
    return try {
      val method = NotificationManager::class.java.getMethod("canPostPromotedNotifications")
      method.invoke(manager) as? Boolean ?: false
    } catch (_: ReflectiveOperationException) {
      false
    } catch (_: SecurityException) {
      false
    }
  }

  fun build(context: Context, summary: AgentStatusSummary): Notification {
    val rows = summary.rows
    val title = title(rows)
    val firstRow = rows.firstOrNull()
    val earliestStartMs = rows.mapNotNull { it.startedAtMs }.minOrNull()
    val manager = context.getSystemService(NotificationManager::class.java)
    val promotionAvailable = canPostPromoted(manager)
    val foreground = parseColor(summary.theme.foregroundColor, Color.BLACK)
    val background = parseColor(summary.theme.backgroundColor, Color.WHITE)
    val accent = parseColor(summary.theme.accentColor, foreground)
    val muted = blend(foreground, background, 0.58f)

    val builder = NotificationCompat.Builder(context, STATUS_CHANNEL_ID)
      .setSmallIcon(smallIcon(context))
      .setContentTitle(title)
      .setContentText(firstRow?.threadTitle?.ifBlank { "Untitled task" } ?: machinesLine(summary))
      .setSubText(firstRow?.let(::rowMetadata) ?: machinesLine(summary))
      .setColor(accent)
      .setColorized(false)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setShowWhen(true)
      .setCategory(NotificationCompat.CATEGORY_PROGRESS)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .setContentIntent(openAppIntent(context, summary, firstRow))

    if (earliestStartMs != null) {
      builder.setWhen(earliestStartMs.toLong()).setUsesChronometer(true)
    } else {
      builder.setShowWhen(false)
    }

    if (promotionAvailable && rows.isNotEmpty()) {
      builder
        .setStyle(progressStyle(rows, accent, muted))
        .setRequestPromotedOngoing(true)
        .setShortCriticalText(chipText(rows))
    } else if (!promotionAvailable) {
      val content = collapsedView(context, summary, title, foreground, background, accent)
      val expanded = expandedView(context, summary, title, foreground, background, accent, muted)
      builder
        .setStyle(NotificationCompat.DecoratedCustomViewStyle())
        .setCustomContentView(content)
        .setCustomBigContentView(expanded)
    }

    return builder.build()
  }

  private fun progressStyle(
    rows: List<AgentStatusRow>,
    accent: Int,
    muted: Int,
  ): NotificationCompat.ProgressStyle {
    val listedRows = rows.take(MAX_LISTED_ROWS)
    val style = NotificationCompat.ProgressStyle()
      .setProgressIndeterminate(true)
      .setStyledByProgress(false)

    listedRows.forEachIndexed { index, row ->
      style.addProgressSegment(
        NotificationCompat.ProgressStyle.Segment(1)
          .setId(row.threadKey.hashCode())
          .setColor(phaseColor(row.phase, accent, muted)),
      )
      if (index > 0) {
        style.addProgressPoint(
          NotificationCompat.ProgressStyle.Point(index)
            .setId(row.threadKey.hashCode())
            .setColor(muted),
        )
      }
    }
    return style
  }

  private fun collapsedView(
    context: Context,
    summary: AgentStatusSummary,
    title: String,
    foreground: Int,
    background: Int,
    accent: Int,
  ): RemoteViews = RemoteViews(context.packageName, R.layout.t3_agent_status_collapsed).apply {
    setInt(R.id.status_collapsed_root, "setBackgroundColor", background)
    setTextColor(R.id.status_collapsed_mark, accent)
    setTextColor(R.id.status_collapsed_title, foreground)
    setTextColor(R.id.status_collapsed_chronometer, foreground)
    setTextViewText(R.id.status_collapsed_title, title)
    setChronometerOrHide(
      R.id.status_collapsed_chronometer,
      summary.rows.mapNotNull { it.startedAtMs }.minOrNull(),
    )
  }

  private fun expandedView(
    context: Context,
    summary: AgentStatusSummary,
    title: String,
    foreground: Int,
    background: Int,
    accent: Int,
    muted: Int,
  ): RemoteViews = RemoteViews(context.packageName, R.layout.t3_agent_status_expanded).apply {
    setInt(R.id.status_expanded_root, "setBackgroundColor", background)
    setTextColor(R.id.status_expanded_mark, accent)
    setTextColor(R.id.status_expanded_title, foreground)
    setTextColor(R.id.status_footer, muted)
    setTextViewText(R.id.status_expanded_title, title)
    setTextViewText(R.id.status_footer, machinesLine(summary))
    removeAllViews(R.id.status_rows)

    summary.rows.take(MAX_LISTED_ROWS).forEach { row ->
      val rowView = RemoteViews(context.packageName, R.layout.t3_agent_status_row).apply {
        setTextColor(R.id.status_row_dot, phaseColor(row.phase, accent, muted))
        setTextColor(R.id.status_row_title, foreground)
        setTextColor(R.id.status_row_metadata, muted)
        setTextColor(R.id.status_row_chronometer, muted)
        setTextViewText(R.id.status_row_title, row.threadTitle.ifBlank { "Untitled task" })
        setTextViewText(R.id.status_row_metadata, rowMetadata(row))
        setChronometerOrHide(R.id.status_row_chronometer, row.startedAtMs)
      }
      addView(R.id.status_rows, rowView)
    }
  }

  private fun RemoteViews.setChronometerOrHide(viewId: Int, startedAtMs: Double?) {
    if (startedAtMs == null) {
      setViewVisibility(viewId, View.GONE)
      return
    }
    val elapsedSinceStart = (System.currentTimeMillis() - startedAtMs.toLong()).coerceAtLeast(0L)
    setViewVisibility(viewId, View.VISIBLE)
    setChronometer(viewId, SystemClock.elapsedRealtime() - elapsedSinceStart, null, true)
  }

  private fun title(rows: List<AgentStatusRow>): String {
    if (rows.any { it.phase == "waiting_for_approval" }) return "Approval needed"
    return when (rows.size) {
      0 -> "No agents running"
      1 -> "1 agent working"
      else -> "${rows.size} agents working"
    }
  }

  private fun rowMetadata(row: AgentStatusRow): String =
    listOf(row.environmentLabel, row.projectTitle)
      .filter { it.isNotBlank() }
      .joinToString(" · ")

  private fun machinesLine(summary: AgentStatusSummary): String {
    val online = summary.onlineCount.coerceAtLeast(0)
    val total = summary.totalCount.coerceAtLeast(0)
    if (online != total) return "$online of $total machines online"
    return when (online) {
      0 -> "No machines online"
      1 -> "1 machine online"
      else -> "$online machines online"
    }
  }

  private fun phaseColor(phase: String, accent: Int, muted: Int): Int =
    when (phase) {
      "waiting_for_approval" -> Color.parseColor(APPROVAL_COLOR)
      "waiting_for_input" -> Color.parseColor(INPUT_COLOR)
      "starting" -> muted
      else -> accent
    }

  private fun chipText(rows: List<AgentStatusRow>): String {
    if (rows.any { it.phase == "waiting_for_approval" }) return "Approve"
    val text = if (rows.size == 1) "1 agent" else "${rows.size} agents"
    return if (text.length <= MAX_CHIP_LENGTH) text else "${rows.size}"
  }

  private fun parseColor(value: String, fallback: Int): Int =
    try {
      Color.parseColor(value)
    } catch (_: IllegalArgumentException) {
      fallback
    }

  private fun blend(foreground: Int, background: Int, foregroundAmount: Float): Int {
    val backgroundAmount = 1f - foregroundAmount
    return Color.rgb(
      (Color.red(foreground) * foregroundAmount + Color.red(background) * backgroundAmount)
        .roundToInt(),
      (Color.green(foreground) * foregroundAmount + Color.green(background) * backgroundAmount)
        .roundToInt(),
      (Color.blue(foreground) * foregroundAmount + Color.blue(background) * backgroundAmount)
        .roundToInt(),
    )
  }

  private fun openAppIntent(
    context: Context,
    summary: AgentStatusSummary,
    firstRow: AgentStatusRow?,
  ): PendingIntent {
    val path = if (summary.rows.size == 1 && firstRow != null) firstRow.deepLink else "/"
    val uri = Uri.parse("${summary.launchUrlScheme}://${path.trimStart('/')}")
    val intent = Intent(Intent.ACTION_VIEW, uri).apply {
      setPackage(context.packageName)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
    return PendingIntent.getActivity(
      context,
      STATUS_NOTIFICATION_ID,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun smallIcon(context: Context): Int {
    val fromResources = context.resources.getIdentifier(
      "notification_icon",
      "drawable",
      context.packageName,
    )
    if (fromResources != 0) return fromResources
    val appInfo: ApplicationInfo = context.applicationInfo
    return appInfo.icon
  }
}
