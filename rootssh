cat >/tmp/enable-root-ssh.sh <<'EOF'
#!/bin/bash
set -e

echo "=== 修改 SSH 配置 ==="
SSHD_CONFIG="/etc/ssh/sshd_config"
cp "$SSHD_CONFIG" "${SSHD_CONFIG}.bak.$(date +%F_%T)"

grep -qE "^[#[:space:]]*PermitRootLogin" "$SSHD_CONFIG" \
  && sed -i "s/^[#[:space:]]*PermitRootLogin.*/PermitRootLogin yes/" "$SSHD_CONFIG" \
  || echo "PermitRootLogin yes" >> "$SSHD_CONFIG"

grep -qE "^[#[:space:]]*PasswordAuthentication" "$SSHD_CONFIG" \
  && sed -i "s/^[#[:space:]]*PasswordAuthentication.*/PasswordAuthentication yes/" "$SSHD_CONFIG" \
  || echo "PasswordAuthentication yes" >> "$SSHD_CONFIG"

echo "=== 重启 SSH 服务 ==="
systemctl restart ssh 2>/dev/null || systemctl restart sshd 2>/dev/null || service ssh restart

echo "=== 配置完成 ==="
EOF
