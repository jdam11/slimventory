import { LockOutlined, UserOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Form, Input, Typography, theme as antdTheme } from "antd";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../store/AuthContext";

const { Title, Text } = Typography;

export default function LoginPage() {
  const { login } = useAuth();
  const { token } = antdTheme.useToken();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onFinish(values: { username: string; password: string }) {
    setError(null);
    setLoading(true);
    try {
      await login(values.username, values.password);
      navigate("/");
    } catch {
      setError("Invalid username or password");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: token.colorBgLayout,
      }}
    >
      <Card
        style={{
          width: 380,
          boxShadow: `0 4px 32px rgba(0,0,0,.25)`,
          border: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgElevated,
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <img
            src="/icon.svg"
            alt="SLIM logo"
            style={{ width: 72, height: 72, marginBottom: 12 }}
          />
          <Title level={2} style={{ margin: 0, letterSpacing: 4 }}>
            SLIM
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            Simple Lab Inventory Manager
          </Text>
        </div>

        {error && (
          <Alert
            type="error"
            message={error}
            showIcon
            style={{ marginBottom: 16 }}
          />
        )}

        <Form onFinish={onFinish} layout="vertical">
          <Form.Item
            name="username"
            rules={[{ required: true, message: "Username is required" }]}
          >
            <Input prefix={<UserOutlined />} placeholder="Username" size="large" />
          </Form.Item>
          <Form.Item
            name="password"
            rules={[{ required: true, message: "Password is required" }]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="Password"
              size="large"
            />
          </Form.Item>
          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              block
              size="large"
            >
              Sign In
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
