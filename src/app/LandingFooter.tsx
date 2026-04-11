import { Typography } from "antd";
import { Link } from "react-router-dom";
import { useSessionStore } from "@/store/useSessionStore";

const { Text } = Typography;

const CONTACT_EMAIL = import.meta.env.VITE_CONTACT_EMAIL as string | undefined;

function openAuthModal() {
  window.dispatchEvent(new Event("nodly-open-auth"));
}

export function LandingFooter() {
  const { user } = useSessionStore();
  const year = new Date().getFullYear();

  return (
    <footer className="landing-footer" aria-label="Подвал сайта">
      <div className="landing-footer__inner">
        <div className="landing-footer__cols">
          <div className="landing-footer__col">
            <Text strong className="landing-footer__col-title">
              Разделы
            </Text>
            <nav className="landing-footer__links">
              <Link to="/">Главная</Link>
              {user ? <Link to="/studio">Разработка</Link> : null}
              {user ? <Link to="/account">Личный кабинет</Link> : null}
              {user?.role === "teacher" ? <Link to="/teacher">Кабинет учителя</Link> : null}
              {user?.role === "student" && user.studentMode === "school" ? (
                <Link to="/class">Обучение</Link>
              ) : null}
              {user?.role === "student" && user.studentMode === "direct" ? (
                <Link to="/learning">Обучение</Link>
              ) : null}
              {!user ? (
                <button type="button" className="landing-footer__link-btn" onClick={openAuthModal}>
                  Войти
                </button>
              ) : null}
            </nav>
          </div>
          <div className="landing-footer__col">
            <Text strong className="landing-footer__col-title">
              О платформе
            </Text>
            <div className="landing-footer__links">
              <a href="#features" className="landing-footer__a">
                Возможности
              </a>
            </div>
          </div>
          <div className="landing-footer__col">
            <Text strong className="landing-footer__col-title">
              Контакты
            </Text>
            <div className="landing-footer__contact">
              {CONTACT_EMAIL ? (
                <a href={`mailto:${CONTACT_EMAIL}`} className="landing-footer__a">
                  {CONTACT_EMAIL}
                </a>
              ) : (
                <Text type="secondary" style={{ fontSize: 13 }}>
                  Вопросы и предложения можно обсудить с администратором вашей организации или через поддержку
                  продукта (почта задаётся в настройках развёртывания: VITE_CONTACT_EMAIL).
                </Text>
              )}
            </div>
          </div>
        </div>
        <div className="landing-footer__bottom">
          <Text type="secondary" style={{ fontSize: 12 }}>
            © {year} Nodly · ИИ и машинное обучение в браузере
          </Text>
        </div>
      </div>
    </footer>
  );
}
