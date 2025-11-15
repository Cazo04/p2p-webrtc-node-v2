#!/bin/bash

#############################################################################
# Auto-Deployment Script for TypeScript Project
# Features:
#   - Auto-build on startup
#   - Create/manage systemd .service file
#   - Auto-restart on failure (3s delay)
#   - Start on boot
#   - Auto-check and pull latest git commits
#   - Auto-update application
#############################################################################

set -e

# Configuration
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_NAME="$(basename "$SCRIPT_DIR")"
SERVICE_NAME="${PROJECT_NAME}-service"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
BUILD_DIR="$SCRIPT_DIR/dist"
MAIN_FILE="$BUILD_DIR/index.js"
CHECK_INTERVAL=300  # Check for updates every 5 minutes
GIT_BRANCH="main"   # Change if using different branch

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

#############################################################################
# Utility Functions
#############################################################################

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

check_root() {
    if [ "$EUID" -ne 0 ]; then
        log_error "This script must be run as root"
        exit 1
    fi
}

#############################################################################
# Build Functions
#############################################################################

build_project() {
    log_info "Building TypeScript project..."
    
    if [ ! -f "$SCRIPT_DIR/package.json" ]; then
        log_error "package.json not found in $SCRIPT_DIR"
        exit 1
    fi
    
    cd "$SCRIPT_DIR"
    
    if [ ! -d "node_modules" ]; then
        log_info "Installing dependencies..."
        npm install
    fi
    
    log_info "Compiling TypeScript..."
    npm run build || npx tsc
    
    if [ ! -f "$MAIN_FILE" ]; then
        log_error "Build failed: $MAIN_FILE not created"
        exit 1
    fi
    
    log_success "Build completed successfully"
}

#############################################################################
# Service Management Functions
#############################################################################

create_service_file() {
    log_info "Creating systemd service file: $SERVICE_FILE"
    
    cat > "$SERVICE_FILE" << EOF
[Unit]
Description=$PROJECT_NAME Auto-Deployed Service
After=network.target

[Service]
Type=simple
User=$SUDO_USER
WorkingDirectory=$SCRIPT_DIR
ExecStart=/usr/bin/node $MAIN_FILE
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal
SyslogIdentifier=$PROJECT_NAME

[Install]
WantedBy=multi-user.target
EOF

    chmod 644 "$SERVICE_FILE"
    log_success "Service file created"
}

reload_systemd() {
    log_info "Reloading systemd daemon..."
    systemctl daemon-reload
    log_success "Systemd reloaded"
}

enable_service() {
    log_info "Enabling service to start on boot..."
    systemctl enable "$SERVICE_NAME.service"
    log_success "Service enabled"
}

restart_service() {
    log_info "Restarting service..."
    
    if systemctl is-active --quiet "$SERVICE_NAME"; then
        systemctl restart "$SERVICE_NAME"
        log_success "Service restarted"
    else
        log_info "Service not running, starting it..."
        systemctl start "$SERVICE_NAME"
        log_success "Service started"
    fi
}

check_service_status() {
    if systemctl is-active --quiet "$SERVICE_NAME"; then
        log_success "Service is running"
        return 0
    else
        log_error "Service is not running"
        return 1
    fi
}

get_service_logs() {
    log_info "Service logs (last 20 lines):"
    journalctl -u "$SERVICE_NAME" -n 20 --no-pager
}

#############################################################################
# Git Update Functions
#############################################################################

check_git_updates() {
    log_info "Checking for git updates..."
    
    cd "$SCRIPT_DIR"
    
    if [ ! -d ".git" ]; then
        log_warning "Not a git repository, skipping git update check"
        return 1
    fi
    
    # Fetch latest changes
    git fetch origin "$GIT_BRANCH" 2>/dev/null || {
        log_warning "Failed to fetch from git"
        return 1
    }
    
    # Check if local is behind remote
    LOCAL=$(git rev-parse HEAD)
    REMOTE=$(git rev-parse origin/"$GIT_BRANCH")
    
    if [ "$LOCAL" = "$REMOTE" ]; then
        log_info "Already up to date"
        return 1
    fi
    
    log_info "Updates available, pulling latest version..."
    return 0
}

pull_and_rebuild() {
    log_info "Pulling latest changes..."
    
    cd "$SCRIPT_DIR"
    git pull origin "$GIT_BRANCH"
    
    log_success "Git pull completed"
    
    log_info "Rebuilding project..."
    build_project
    
    log_success "Project rebuilt successfully"
}

#############################################################################
# Auto-Update Monitor (Background Process)
#############################################################################

start_update_monitor() {
    log_info "Starting auto-update monitor..."
    
    # Create monitor script
    MONITOR_SCRIPT="$SCRIPT_DIR/.auto-update-monitor.sh"
    
    cat > "$MONITOR_SCRIPT" << 'MONITOR_EOF'
#!/bin/bash

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
CHECK_INTERVAL=300
GIT_BRANCH="main"

# Suppress logs for background process
exec 1>/dev/null 2>&1

while true; do
    sleep $CHECK_INTERVAL
    
    cd "$SCRIPT_DIR"
    
    if [ ! -d ".git" ]; then
        continue
    fi
    
    if ! git fetch origin "$GIT_BRANCH" 2>/dev/null; then
        continue
    fi
    
    LOCAL=$(git rev-parse HEAD)
    REMOTE=$(git rev-parse origin/"$GIT_BRANCH")
    
    if [ "$LOCAL" != "$REMOTE" ]; then
        git pull origin "$GIT_BRANCH"
        
        # Build and restart
        if npm run build 2>/dev/null || npx tsc 2>/dev/null; then
            systemctl restart "$(basename $SCRIPT_DIR)-service" 2>/dev/null
        fi
    fi
done
MONITOR_EOF

    chmod +x "$MONITOR_SCRIPT"
    
    # Start monitor in background
    nohup "$MONITOR_SCRIPT" > /dev/null 2>&1 &
    MONITOR_PID=$!
    
    # Save PID
    echo "$MONITOR_PID" > "$SCRIPT_DIR/.auto-update-monitor.pid"
    
    log_success "Auto-update monitor started (PID: $MONITOR_PID)"
}

stop_update_monitor() {
    MONITOR_PID_FILE="$SCRIPT_DIR/.auto-update-monitor.pid"
    
    if [ -f "$MONITOR_PID_FILE" ]; then
        MONITOR_PID=$(cat "$MONITOR_PID_FILE")
        if kill -0 "$MONITOR_PID" 2>/dev/null; then
            kill "$MONITOR_PID"
            log_success "Auto-update monitor stopped"
        fi
        rm "$MONITOR_PID_FILE"
    fi
}

#############################################################################
# Main Setup Functions
#############################################################################

initial_setup() {
    check_root
    log_info "Starting initial setup..."
    
    # Build project
    build_project
    
    # Create service file
    create_service_file
    reload_systemd
    enable_service
    
    # Start service
    restart_service
    
    # Start auto-update monitor
    start_update_monitor
    
    log_success "Setup completed successfully!"
    log_info "Service name: $SERVICE_NAME"
    log_info "Service file: $SERVICE_FILE"
    log_info "Project directory: $SCRIPT_DIR"
}

#############################################################################
# Command Handler
#############################################################################

show_help() {
    cat << EOF
Usage: sudo $0 [COMMAND]

Commands:
    setup              Initial setup (build, create service, enable, start)
    build              Build TypeScript project
    start              Start the service
    stop               Stop the service
    restart            Restart the service
    status             Check service status
    logs               Show service logs
    check-updates      Check for git updates
    update             Pull updates and rebuild
    monitor-start      Start auto-update monitor
    monitor-stop       Stop auto-update monitor
    remove             Remove service and cleanup
    help               Show this help message

Examples:
    sudo $0 setup                  # Initial setup
    sudo $0 status                 # Check service status
    sudo $0 logs                   # View logs
    sudo $0 update                 # Manual update
    sudo $0 remove                 # Remove service

EOF
}

#############################################################################
# Main Script
#############################################################################

main() {
    COMMAND="${1:-help}"
    
    case "$COMMAND" in
        setup)
            initial_setup
            ;;
        build)
            build_project
            ;;
        start)
            check_root
            restart_service
            ;;
        stop)
            check_root
            log_info "Stopping service..."
            systemctl stop "$SERVICE_NAME"
            log_success "Service stopped"
            ;;
        restart)
            check_root
            restart_service
            ;;
        status)
            check_service_status
            get_service_logs
            ;;
        logs)
            get_service_logs
            ;;
        check-updates)
            check_git_updates
            ;;
        update)
            check_root
            if check_git_updates; then
                pull_and_rebuild
                restart_service
                log_success "Update completed"
            fi
            ;;
        monitor-start)
            check_root
            start_update_monitor
            ;;
        monitor-stop)
            check_root
            stop_update_monitor
            ;;
        remove)
            check_root
            log_warning "Removing service..."
            stop_update_monitor 2>/dev/null || true
            systemctl stop "$SERVICE_NAME" 2>/dev/null || true
            systemctl disable "$SERVICE_NAME" 2>/dev/null || true
            rm -f "$SERVICE_FILE"
            systemctl daemon-reload
            rm -f "$SCRIPT_DIR/.auto-update-monitor.sh"
            rm -f "$SCRIPT_DIR/.auto-update-monitor.pid"
            log_success "Service removed"
            ;;
        help)
            show_help
            ;;
        *)
            log_error "Unknown command: $COMMAND"
            show_help
            exit 1
            ;;
    esac
}

main "$@"
