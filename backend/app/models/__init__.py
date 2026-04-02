# Import all models here so Alembic can detect them
from app.models.user import User, RefreshToken  # noqa: F401
from app.models.material import Material  # noqa: F401
from app.models.disassembly import (  # noqa: F401
    DisassemblyTask,
    DisassemblyModule,
    ModuleDependency,
    SpecialistOutput,
    QuizData,
)
from app.models.course import CourseCategory, Course, CourseMaterialSource  # noqa: F401
from app.models.student_profile import StudentProfile  # noqa: F401
from app.models.tutor_session import TutorSession  # noqa: F401
from app.models.knowledge_card import KnowledgeCardData  # noqa: F401
from app.models.user_llm_settings import UserLLMSettings  # noqa: F401
