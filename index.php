<?php

$sound = true;
$on_vr_headset = !!(preg_match("#Oculus#i", $_SERVER['HTTP_USER_AGENT']));
$remote_logging_enabled = $on_vr_headset;
//$remote_logging_enabled = true;
$console_log_prefix = "remote-console";
$logs_dir = "logs";

$parts = pathinfo($_SERVER['SCRIPT_FILENAME']);
$base_path = $parts['dirname'];
if (!file_exists($base_path)) {
    throw new Exception("Can't find base path " . $base_path);
}

$cachebust = time();
//$cachebust = 1;
$cachebust = md5($cachebust);

// ajax
if (isset($_REQUEST['log']) && $_REQUEST['log']) {
    $log = $_REQUEST['log'];
    $log = json_decode($_REQUEST['log'], true);
    foreach ($log['log_msgs'] as $log_msg) {
        $log_msg = date("Y-m-d H:i:s") . "\t" . $log_msg;
        $log_file = $base_path . "/" . $logs_dir . "/" . $console_log_prefix . "_" . date("Ym") . ".log";
        error_log($log_msg . "\n", 3, $log_file);
    }
    exit;
}
// end ajax

print '<!DOCTYPE html>';
print '
<html lang="en">
<head>

<script async src="https://www.googletagmanager.com/gtag/js?id=G-06CNB22BQV"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag("js", new Date());

  gtag("config", "G-06CNB22BQV");
</script>

<title>Galaxy Invaders 3D</title>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
<link rel="stylesheet" href="main.css?v=' . $cachebust . '" type="text/css" />
<script type="importmap">
{
    "imports": {"three": "https://unpkg.com/three@0.138.3/build/three.module.js"}
}
</script>
<script type="module" src="main.js?v=' . $cachebust . '"></script>

</head>
<body>
';

$options = array(
    "on_vr_headset" => $on_vr_headset,
    "remote_logging_enabled" => $remote_logging_enabled,
    "sound" => $sound,
);
print '<script src="https://ajax.googleapis.com/ajax/libs/jquery/3.6.0/jquery.min.js"></script>';
print '
<script>
var options = ' . json_encode($options) . ';
</script>
</body>
</html>
';
